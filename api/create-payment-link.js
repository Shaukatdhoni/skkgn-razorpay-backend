
const crypto = require("crypto");

const PLANS = {
  Test: {
    amount: 100,
    description: "SK KGN TEAM Test Payment - Registration Flow"
  },
  Basic: {
    amount: 9900,
    description: "Basic Service Professional Complaint Draft"
  },
  Advance: {
    amount: 19900,
    description: "Advance Service Professional Complaint"
  },
  Premium: {
    amount: 29900,
    description:
      "Draft + Lodge + Feedback + Reminder + Follow-up + 1 Re-Complaint"
  }
};

// CORS CONFIGURATION
function setCors(req, res) {
  const allowedOrigins = [
    "https://skkgnteam.in",
    "https://www.skkgnteam.in"
  ];

  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  res.setHeader("Vary", "Origin");
}

// ENCRYPT COMPLAINT DATA
function encrypt(text, secret) {
  const key = crypto
    .createHash("sha256")
    .update(secret)
    .digest();

  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    key,
    iv
  );

  const encrypted = Buffer.concat([
    cipher.update(text, "utf8"),
    cipher.final()
  ]);

  return [
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url")
  ].join(".");
}

module.exports = async (req, res) => {
  setCors(req, res);

  // Handle browser preflight request
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const {
      plan,
      name,
      mobile,
      subject,
      details,
      returnTo
    } = req.body || {};

    // Validate selected plan
    const selectedPlan = PLANS[plan];

    if (!selectedPlan) {
      return res.status(400).json({
        error: "Invalid plan selected"
      });
    }

    // Validate complaint details
    if (
      !name ||
      !mobile ||
      !subject ||
      !details
    ) {
      return res.status(400).json({
        error: "Required complaint details are missing"
      });
    }

    const cleanName = String(name).trim();
    const cleanMobile = String(mobile).trim();
    const cleanSubject = String(subject).trim();
    const cleanDetails = String(details).trim();

    if (
      !cleanName ||
      !cleanMobile ||
      !cleanSubject ||
      !cleanDetails
    ) {
      return res.status(400).json({
        error: "Complaint details cannot be empty"
      });
    }

    if (cleanDetails.length > 1500) {
      return res.status(400).json({
        error: "Complaint description is too long"
      });
    }

    // Backend environment variables
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    const encryptionSecret =
      process.env.COMPLAINT_ENCRYPTION_SECRET;

    if (
      !keyId ||
      !keySecret ||
      !encryptionSecret
    ) {
      return res.status(500).json({
        error: "Server environment variables are missing"
      });
    }

    // Generate unique reference ID
    const referenceId =
      "SKKGN" +
      Date.now().toString(36).toUpperCase() +
      crypto.randomBytes(3).toString("hex").toUpperCase();

    // Encrypt complaint information
    const encrypted = encrypt(
      JSON.stringify({
        name: cleanName,
        mobile: cleanMobile,
        subject: cleanSubject,
        details: cleanDetails,
        plan: String(plan)
      }),
      encryptionSecret
    );

    // Split encrypted data into Razorpay notes
    const chunks = encrypted.match(/.{1,240}/g) || [];

    // Razorpay notes support a maximum of 15 entries
    if (chunks.length > 15) {
      return res.status(400).json({
        error: "Complaint data is too large"
      });
    }

    const notes = {};

    chunks.forEach((value, index) => {
      notes[
        "skkgn_" + String(index + 1).padStart(2, "0")
      ] = value;
    });

    // Razorpay authentication
    const auth = Buffer
      .from(`${keyId}:${keySecret}`)
      .toString("base64");

    // Create Razorpay Payment Link
    const razorpayResponse = await fetch(
      "https://api.razorpay.com/v1/payment_links",
      {
        method: "POST",

        headers: {
          "Authorization": `Basic ${auth}`,
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          amount: selectedPlan.amount,
          currency: "INR",
          accept_partial: false,
          reference_id: referenceId,
          description: selectedPlan.description,

          customer: {
            name: cleanName,
            contact: cleanMobile
          },

          notes: notes,

          callback_url:
            returnTo === "store"
              ? "https://skkgn-razorpay-backend.vercel.app/api/payment-callback?returnTo=store"
              : "https://skkgn-razorpay-backend.vercel.app/api/payment-callback",

          callback_method: "get",
          reminder_enable: false
        })
      }
    );

    const data = await razorpayResponse.json();

    if (!razorpayResponse.ok) {
      console.error(
        "Razorpay API Error:",
        data
      );

      return res.status(razorpayResponse.status).json({
        error:
          data.error?.description ||
          "Razorpay Payment Link creation failed"
      });
    }

    if (!data.short_url || !data.id) {
      return res.status(502).json({
        error: "Invalid response from Razorpay"
      });
    }

    return res.status(200).json({
      ok: true,
      shortUrl: data.short_url,
      paymentLinkId: data.id,
      referenceId: referenceId
    });

  } catch (error) {
    console.error(
      "Create Payment Link Error:",
      error
    );

    return res.status(500).json({
      error: "Internal server error"
    });
  }
};
