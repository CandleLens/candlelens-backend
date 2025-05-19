require('dotenv').config();
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

console.log('✅ Using Webhook Secret:', process.env.STRIPE_WEBHOOK_SECRET);


const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path'); // ⬅️ move this UP
const { OpenAI } = require('openai');
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);
const app = express();


app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    console.log('📬 Webhook received:', event.type);
  } catch (err) {
    console.error('❌ Invalid Stripe webhook signature:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }


if (event.type === 'checkout.session.completed') {
  const session = event.data.object;
  console.log('🔍 Full session:', JSON.stringify(session, null, 2));

  let email = session.customer_email || session.metadata?.email || session.customer_details?.email;

  if (!email && session.customer) {
    try {
      const customer = await stripe.customers.retrieve(session.customer);
      email = customer.email;
      console.log('📥 Retrieved customer email from customer object:', email);
    } catch (err) {
      console.error('❌ Failed to retrieve customer from Stripe:', err.message);
    }
  }

  if (!email) {
    console.warn('⚠️ No email found in session or customer object');
    return res.status(400).send('Missing email');
  }

  // ✅ Add to subscribers.json
  let subscribers = [];
  if (fs.existsSync(SUBSCRIBERS_FILE)) {
    try {
      subscribers = JSON.parse(fs.readFileSync(SUBSCRIBERS_FILE, 'utf-8'));
    } catch (err) {
      console.error('⚠️ Failed to read subscribers.json:', err);
    }
  }

  if (!subscribers.includes(email)) {
    subscribers.push(email);
    fs.writeFileSync(SUBSCRIBERS_FILE, JSON.stringify(subscribers, null, 2));
    console.log(`✅ Added to subscribers: ${email}`);
  }

  res.json({ received: true });
}
}); 


app.use(express.json());
app.use(cors());
app.use(express.urlencoded({ extended: true }));


const upload = multer({ dest: 'uploads/' });

const USERS_FILE = path.join(__dirname, 'users.json');
const CANCELS_FILE = path.join(__dirname, 'cancel_requests.json'); // ✅ now works fine
const SUBSCRIBERS_FILE = path.join(__dirname, 'subscribers.json'); // ✅ MOVE IT HERE
const TERMS_FILE = path.join(__dirname, 'terms_accepted.json'); // ✅ for tracking terms

function saveTermsAccepted(email) {
  let accepted = [];
  if (fs.existsSync(TERMS_FILE)) {
    try {
      accepted = JSON.parse(fs.readFileSync(TERMS_FILE, 'utf-8'));
    } catch (err) {
      // console.error('⚠️ Failed to parse terms_accepted.json:', err);
    }
  }

  if (!accepted.includes(email)) {
    accepted.push(email);
    fs.writeFileSync(TERMS_FILE, JSON.stringify(accepted, null, 2));
    // console.log(`📜 Terms accepted by: ${email}`);
  }
}

function saveVerifiedEmail(email) {
  let users = [];
  if (fs.existsSync(USERS_FILE)) {
    try {
      users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
    } catch (err) {
      console.error('⚠️ Failed to parse users.json:', err);
    }
  }

  if (!users.includes(email)) {
    users.push(email);
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    console.log(`✅ Saved verified email: ${email}`);
  }
}

app.post('/accept-terms', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  saveTermsAccepted(email);
  res.json({ success: true });
});

app.get('/has-accepted-terms', (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Email required' });

  let accepted = [];
  if (fs.existsSync(TERMS_FILE)) {
    try {
      accepted = JSON.parse(fs.readFileSync(TERMS_FILE, 'utf-8'));
    } catch (err) {
      console.error('⚠️ Failed to parse terms_accepted.json:', err);
    }
  }

  res.json({ accepted: accepted.includes(email) });
});


app.post('/create-checkout-session', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: email,
      line_items: [
        {
          price: 'price_1ROl8RLIT003sli4gEg7gv9Y',
          quantity: 1,
        },
      ],
      success_url: 'https://5354-2600-4040-95b2-ba00-4df0-aa76-eaf8-118c.ngrok-free.app/success',
      cancel_url: 'https://5354-2600-4040-95b2-ba00-4df0-aa76-eaf8-118c.ngrok-free.app/cancel',
      metadata: { email },
    });

    console.log('✅ Created Stripe session:', session.url);
    res.json({ url: session.url });

  } catch (err) {
    console.error('❌ Stripe session error:', err);
    res.status(500).json({ error: 'Failed to create Stripe session' });
  }
});



app.post('/cancel-subscription', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  let cancels = [];
  if (fs.existsSync(CANCELS_FILE)) {
    try {
      cancels = JSON.parse(fs.readFileSync(CANCELS_FILE, 'utf-8'));
    } catch (err) {
      console.error('⚠️ Failed to parse cancel_requests.json:', err);
    }
  }

  if (!cancels.includes(email)) {
    cancels.push(email);
    fs.writeFileSync(CANCELS_FILE, JSON.stringify(cancels, null, 2));
    console.log(`📩 Cancellation recorded for: ${email}`);
  }

  // ✅ Send an email notification to yourself
  try {
    await resend.emails.send({
      from: 'cancel@candlelens.com',
      to: 'CandleLensApp@gmail.com',
      subject: '🛑 Cancellation Requested',
      html: `<p>User <strong>${email}</strong> has requested to cancel their subscription.</p>`,
    });
    console.log('📧 Notification email sent to CandleLensApp@gmail.com');
  } catch (err) {
    console.error('❌ Failed to send cancellation email:', err);
  }

  res.json({ success: true });
});

 

// ✅ Stripe Webhook

 

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

let previousPair = null;


app.get('/', (req, res) => {
  res.send('Server is working');
});

app.post('/analyze', upload.single('image'), async (req, res) => {
  console.log(`📩 Received request: ${req.method} ${req.originalUrl}`);
  try {
    const imagePath = req.file.path;
    const imageData = fs.readFileSync(imagePath).toString('base64');
    const base64ImageUrl = `data:image/jpeg;base64,${imageData}`;

    const systemPrompt = `
    You are a professional trading chart analyst.

    ❌ Do NOT mention the trading pair (e.g., GBPUSD, EUR/USD) or the timeframe (e.g., 1H, 15M, etc.) in any part of your response.

    
    🚫 IMPORTANT:
    - You must extract the **timeframe ONLY** by reading the exact label shown at the **top-left of the chart** (e.g., “EURUSD   m15”).
    - NEVER guess the timeframe based on candle spacing or chart context.
    - If the label is missing, cropped, or unreadable, return: “Timeframe: Not Identified”

    ✅ Common timeframes:
    - “m1” → “1M”
    - “m5” → “5M”
    - “m10” → “10M”
    - “m15” → “15M”
    - “m20” → “20M”
    - “m30” → “30M”
    - “H1” / “1H” → “1H”
    - “H4” / “4H” → “4H”
    - “1D” → “1D”
    - “W1” → “1W”
    - “MN” → “1MO”

    ⚠️ “m30” is **NOT** the same as “1H”. Do not confuse or round.

    Your task is to return clean, structured analysis in this exact format:
    ---

    📈 **Trading Recommendation**  
    **Type:** Buy  
    **Order Type:** Limit  
    **Entry Price:** 1.1234  
    **Take Profit:** 1.1350  
    **Stop Loss:** 1.1180  
    **Trend:** Uptrend  
    **Volume:** Moderate  
    **Volatility:** Low  
    **Market Sentiment:** Bullish  
**Confidence Level:** [Give a realistic confidence estimate as a percentage from 0% to 100%. Be bold when signals align and strong patterns are visible. Use <30% if conditions are confusing or conflicting. Only assign 90%+ when the chart setup is extremely clear, with strong confluence across multiple indicators and price structure.]

now i
🎯 Confidence Guidelines:
- Return a confidence level as a percentage: **Confidence Level:** 0% to 100%
- Be precise. Do NOT round. Avoid clean numbers like 70%, 75%, or 80% unless truly exact.
- You may return values like 63%, 78%, or 91% if that's what your analysis supports.
- Base your estimate on how aligned the indicators are, the strength of the setup, and the chart readability.


    🧠 **Bias Explanation:** The chart is forming higher highs with consistent volume support and moving average crossovers.

    🛠️ **Suggested Indicators:**  
    • RSI divergence  
    • Bollinger Band breakout  
    • MACD confirmation

    📊 **Full Technical Analysis**  
• Pattern: Describe the chart pattern in detail and what it implies (e.g., “Bearish wedge indicates sellers are gaining strength after consolidation”).  
• Indicators Used: List technical indicators that were clearly visible  
• Volume Analysis: Describe volume conditions (e.g., “Volume rising on red candles suggests increasing sell pressure”)  
• Volatility Status: Describe the volatility as Low, Moderate, or High  
• Market Context: Summarize what's happening in the market based on price structure and indicator alignment  
• Confidence Level: Give a percentage (0%-100%) based on clarity and signal alignment  
• Risk to Reward: Give an estimated R:R ratio if possible  
• Breakout Zone: Mention any important price range that indicates a likely breakout  
• Trend Strength: Low, Moderate, Strong based on momentum + direction

    ---

    ⚠️ If any value is missing, say “Not Identified”.
    ⚠️ Suggested Indicators must not repeat Indicators Used.
    `.trim();

    const response = await openai.chat.completions.create({
      model: 'gpt-4-turbo',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze the chart and extract everything' },
            { type: 'image_url', image_url: { url: base64ImageUrl } },
          ],
        },
      ],
      max_tokens: 1000,
    });

    fs.unlinkSync(imagePath);

    let analysis = response.choices?.[0]?.message?.content?.trim();
    console.log('🧠 Raw AI Response:\n', analysis);

    // Timeframe fallback injection
    let extractedTimeframe = null;
    if (!analysis.toLowerCase().includes('timeframe:')) {
      const tfFromImageMatch = base64ImageUrl.match(/\bm(1|5|10|15|20|30)\b|\b1h\b|\b4h\b|\b1d\b|\bw1\b|\bmn\b/i);
      if (tfFromImageMatch) {
        const rawTF = tfFromImageMatch[0].toLowerCase();
        const tfMap = {
          m1: '1M', m5: '5M', m10: '10M', m15: '15M', m20: '20M', m30: '30M',
          '1h': '1H', '4h': '4H', '1d': '1D', w1: '1W', mn: '1MO'
        };
        extractedTimeframe = tfMap[rawTF] || 'Not Identified';
        analysis = `Timeframe: ${extractedTimeframe}\n` + analysis;
      }
    }

    // Pair extraction
    let extractedPair = null;
    const pairRegexes = [
      /\b([A-Z]{3})\/([A-Z]{3})\b/,     // strict format like EUR/USD
      /\b([A-Z]{6})\b/,                 // fallback like EURUSD
    ];
    

    for (const regex of pairRegexes) {
      const match = analysis?.match(regex);
      if (match) {
        const val = match[1].toUpperCase();
        if (val.length === 7 && !val.includes('/')) {
          extractedPair = `${val.slice(0, 3)}/${val.slice(3)}`;
        } else {
          extractedPair = val.includes('/') ? val : val.slice(0, 3) + '/' + val.slice(3);
        }
        break;
      }
    }

    if (extractedPair) previousPair = extractedPair;

    // Timeframe extraction from analysis text
    const tfRegexes = [
      /\bTimeframe:\s*(\d{1,2})(m|h|d|w|mo|min|hr|hour|day|week|month)\b/i,
      /\b([mhdw])(\d{1,2})\b/i,
      /\b(\d{1,2})(m|h|d|w|mo|min|hr|hour|day|week|month)\b/i,
    ];

    const unitMap = {
      m: 'M', min: 'M', minute: 'M', minutes: 'M',
      h: 'H', hr: 'H', hour: 'H', hours: 'H',
      d: 'D', day: 'D', days: 'D',
      w: 'W', week: 'W', weeks: 'W',
      mo: 'MO', month: 'MO', months: 'MO',
    };

    for (const regex of tfRegexes) {
      const match = analysis?.match(regex);
      if (match) {
        const num = match[1] || match[2];
        const unit = match[2] || match[1];
        const normalizedUnit = unitMap[unit.toLowerCase()];
        if (num && normalizedUnit) {
          extractedTimeframe = `${num}${normalizedUnit}`;
          break;
        }
      }
    }

    // Clean analysis output
    analysis = analysis
      .replace(/^\d+\.\s*/gm, '')
      .replace(/•\s*/g, '')
      .replace(/\n{2,}/g, '\n')
      .trim();

      // Deduplicate lines
const uniqueLines = [...new Set(analysis.split('\n').map(line => line.trim()))];
analysis = uniqueLines.join('\n');


    console.log('🧪 Final Output:', {
      analysis,
      pair: extractedPair || previousPair || null,
      timeframe: extractedTimeframe || null,
    });

// Extract confidence percentage
let confidencePercent = null;
const confidenceMatch = analysis.match(/confidence\s*level[:\s]*([0-9]{1,3})%/i);

if (confidenceMatch) {
  confidencePercent = parseInt(confidenceMatch[1]);
  console.log('📊 Extracted Confidence (main):', confidencePercent);
} else {
  const fallback = analysis.match(/confidence\s*level[:\s]*([0-9]{1,3})%\*+/i);
  if (fallback) {
    confidencePercent = parseInt(fallback[1]);
    console.log('📊 Extracted Confidence (fallback):', confidencePercent);
  }
}



res.json({
  analysis: analysis || '❗ AI did not return any analysis. Try a clearer chart.',
  pair: extractedPair || null,
  timeframe: extractedTimeframe || null,
  confidence: typeof confidencePercent === 'number' ? confidencePercent : null,
});




  } catch (err) {
    console.error('❌ Error during analysis:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const loginCodes = {};
const verifiedEmails = new Set();

app.post('/send-code', async (req, res) => {
  const email = req.body?.email;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  loginCodes[email] = { code, createdAt: Date.now() };
  console.log('📥 Code stored:', loginCodes[email]);


  try {
    await resend.emails.send({
      from: 'login@candlelens.com', // ✅ now valid
      to: email,
      subject: 'Your CandleLens Login Code',
      html: `<p>Your one-time login code is <strong>${code}</strong>. It will expire in 5 minutes.</p>`,
    });
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Email send error:', err);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

app.post('/verify-code', (req, res) => {
  const { email, code } = req.body;
  const record = loginCodes[email];
  console.log('🔍 Trying to verify:', { email, codeReceived: code, storedRecord: record });


  if (!record || Date.now() - record.createdAt > 5 * 60 * 1000) {
    return res.status(401).json({ error: 'Code expired or not found' });
  }

  if (record.code !== code) {
    return res.status(401).json({ error: 'Invalid code' });
  }

  verifiedEmails.add(email);
  saveVerifiedEmail(email);
  delete loginCodes[email];
  res.json({ verified: true });
});

app.get('/me', (req, res) => {
  const { email } = req.query;

  const isVerified = verifiedEmails.has(email);

  let subscribed = false;
  if (fs.existsSync(SUBSCRIBERS_FILE)) {
    try {
      const subscribers = JSON.parse(fs.readFileSync(SUBSCRIBERS_FILE, 'utf-8'));
      subscribed = subscribers.includes(email);
    } catch (err) {
      console.error('⚠️ Failed to read subscribers.json:', err);
    }
  }

  res.json({
    verified: isVerified,
    subscribed: subscribed,
  });
});



app.get('/analyze', (req, res) => {
  res.status(405).send('❌ Use POST method instead of GET');
});


app.get('/success', (req, res) => {
  res.send('✅ Subscription successful. You may close this tab.');
});

app.get('/cancel', (req, res) => {
  res.send('❌ Subscription canceled. You may close this tab.');
});


const PORT = 3001;
app.listen(3001, '0.0.0.0', () => {
  console.log('Server is running on http://192.168.1.171:3001');
});
