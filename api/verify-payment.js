const crypto = require("crypto");

function setCors(res) {
  res.setHeader(
    "Access-Control-Allow-Origin",
    "https://skkgnteam.in"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  res.setHeader("Vary", "Origin");
}

function sign(value, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(value)
    .digest("hex");
}

function safeEqual(a, b) {
  if (!a || !b) return false;

  const x = Buffer.from(a);
  const y = Buffer.from(b);

  return (
    x.length === y.length &&
    crypto.timingSafeEqual(x, y)
  );
}

function decrypt(text, secret) {
  const key = crypto
    .createHash("sha256")
    .update(secret)
    .digest();

  const [ivB64, tagB64, encB64] =
    text.split(".");

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivB64, "base64url")
  );

  decipher.setAuthTag(
    Buffer.from(tagB64, "base64url")
  );

  return Buffer.concat([
    decipher.update(
      Buffer.from(encB64, "base64url")
    ),
    decipher.final()
  ]).toString("utf8");
}

module.exports = async (req, res) => {

  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res
      .status(405)
      .json({
        error: "Method not allowed"
      });
  }

  try {

    const token =
      String(req.query.token || "");

    const dot =
      token.lastIndexOf(".");

    if (dot < 1) {
      return res
        .status(400)
        .json({
          error: "Invalid token"
        });
    }

    const payload =
      token.slice(0, dot);

    const signature =
      token.slice(dot + 1);

    const tokenSecret =
      process.env.CALLBACK_TOKEN_SECRET;

    const encryptionSecret =
      process.env.COMPLAINT_ENCRYPTION_SECRET;

    const keyId =
      process.env.RAZORPAY_KEY_ID;

    const keySecret =
      process.env.RAZORPAY_KEY_SECRET;

    if (
      !tokenSecret ||
      !encryptionSecret ||
      !keyId ||
      !keySecret
    ) {
      return res
        .status(500)
        .json({
          error:
            "Server secrets are missing"
        });
    }

    if (
      !safeEqual(
        sign(payload, tokenSecret),
        signature
      )
    ) {
      return res
        .status(401)
        .json({
          error:
            "Invalid verification token"
        });
    }

    const info =
      JSON.parse(
        Buffer
          .from(
            payload,
            "base64url"
          )
          .toString("utf8")
      );

    if (
      !info.exp ||
      Date.now() > info.exp
    ) {
      return res
        .status(401)
        .json({
          error:
            "Verification token expired"
        });
    }

    const auth =
      Buffer
        .from(
          `${keyId}:${keySecret}`
        )
        .toString("base64");

    const razorpayResponse =
      await fetch(
        `https://api.razorpay.com/v1/payment_links/${encodeURIComponent(info.link_id)}`,
        {
          headers: {
            "Authorization":
              `Basic ${auth}`
          }
        }
      );

    const link =
      await razorpayResponse.json();

    if (!razorpayResponse.ok) {
      return res
        .status(502)
        .json({
          error:
            "Could not verify Payment Link"
        });
    }

    if (
      link.status !== "paid" ||
      link.reference_id !==
        info.reference_id ||
      link.amount_paid < link.amount
    ) {
      return res
        .status(400)
        .json({
          error:
            "Payment is not verified"
        });
    }

    const notes =
      link.notes || {};

    const encrypted =
      Object.keys(notes)
        .filter(
          key =>
            /^skkgn_\d+$/.test(key)
        )
        .sort()
        .map(
          key => notes[key]
        )
        .join("");

    const complaint =
      JSON.parse(
        decrypt(
          encrypted,
          encryptionSecret
        )
      );

    return res
      .status(200)
      .json({

        ok: true,

        paymentStatus:
          "Completed",

        razorpayPaymentId:
          info.payment_id,

        paymentLinkId:
          info.link_id,

        referenceId:
          info.reference_id,

        complaint

      });

  } catch (e) {

    console.error(e);

    return res
      .status(500)
      .json({
        error:
          "Verification failed"
      });

  }

};