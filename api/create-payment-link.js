const crypto = require("crypto");

const PLANS = {
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
    description: "Premium Service Professional Complaint"
  }
};

function encrypt(text, secret) {
  const key = crypto.createHash("sha256").update(secret).digest();
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    key,
    iv
  );

  const enc = Buffer.concat([
    cipher.update(text, "utf8"),
    cipher.final()
  ]);

  return [
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    enc.toString("base64url")
  ].join(".");
}

module.exports = async (req, res) => {

  if (req.method !== "POST") {
    return res
      .status(405)
      .json({
        error: "Method not allowed"
      });
  }

  try {

    const {
      plan,
      name,
      mobile,
      subject,
      details
    } = req.body || {};

    const p = PLANS[plan];

    if (!p) {
      return res
        .status(400)
        .json({
          error: "Invalid plan"
        });
    }

    if (
      !name ||
      !mobile ||
      !subject ||
      !details
    ) {
      return res
        .status(400)
        .json({
          error: "Missing complaint details"
        });
    }

    const keyId =
      process.env.RAZORPAY_KEY_ID;

    const keySecret =
      process.env.RAZORPAY_KEY_SECRET;

    const encSecret =
      process.env.COMPLAINT_ENCRYPTION_SECRET;

    if (
      !keyId ||
      !keySecret ||
      !encSecret
    ) {
      return res
        .status(500)
        .json({
          error:
            "Server environment variables are missing"
        });
    }

    const referenceId =
      "SKKGN" +
      Date.now()
        .toString(36)
        .toUpperCase() +
      crypto
        .randomBytes(3)
        .toString("hex")
        .toUpperCase();

    const encrypted =
      encrypt(
        JSON.stringify({
          name: String(name),
          mobile: String(mobile),
          subject: String(subject),
          details: String(details),
          plan: String(plan)
        }),
        encSecret
      );

    const chunks =
      encrypted.match(/.{1,240}/g) || [];

    const notes = {};

    chunks
      .slice(0, 15)
      .forEach((value, index) => {

        notes[
          "skkgn_" +
          String(index + 1)
            .padStart(2, "0")
        ] = value;

      });

    const auth =
      Buffer
        .from(
          `${keyId}:${keySecret}`
        )
        .toString("base64");

    const r =
      await fetch(
        "https://api.razorpay.com/v1/payment_links",
        {
          method: "POST",

          headers: {
            "Authorization":
              `Basic ${auth}`,

            "Content-Type":
              "application/json"
          },

          body: JSON.stringify({

            amount:
              p.amount,

            currency:
              "INR",

            accept_partial:
              false,

            reference_id:
              referenceId,

            description:
              p.description,

            notes:
              notes,

            callback_url:
              "https://YOUR-VERCEL-DOMAIN.vercel.app/api/payment-callback",

            callback_method:
              "get",

            reminder_enable:
              false

          })
        }
      );

    const data =
      await r.json();

    if (!r.ok) {

      return res
        .status(r.status)
        .json({
          error:
            data.error?.description ||
            "Razorpay Payment Link creation failed"
        });

    }

    return res
      .status(200)
      .json({

        ok: true,

        shortUrl:
          data.short_url,

        paymentLinkId:
          data.id,

        referenceId:
          referenceId

      });

  } catch (e) {

    console.error(e);

    return res
      .status(500)
      .json({
        error:
          "Server error"
      });

  }

};
