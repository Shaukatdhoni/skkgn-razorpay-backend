const crypto = require("crypto");

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

module.exports = async (req, res) => {

  if (req.method !== "GET") {
    return res
      .status(405)
      .send("Method not allowed");
  }

  try {

    const {
      razorpay_payment_id,
      razorpay_payment_link_id,
      razorpay_payment_link_reference_id,
      razorpay_payment_link_status,
      razorpay_signature
    } = req.query;

    if (
      !razorpay_payment_id ||
      !razorpay_payment_link_id ||
      !razorpay_payment_link_reference_id ||
      !razorpay_payment_link_status ||
      !razorpay_signature
    ) {
      return res
        .status(400)
        .send("Missing Razorpay callback parameters");
    }

    if (
      razorpay_payment_link_status !== "paid"
    ) {
      return res.redirect(
        "https://skkgnteam.in/?payment=failed"
      );
    }

    const secret =
      process.env.RAZORPAY_KEY_SECRET;

    const tokenSecret =
      process.env.CALLBACK_TOKEN_SECRET;

    if (!secret || !tokenSecret) {
      return res
        .status(500)
        .send("Server secrets are missing");
    }

    const signedValue = [
      razorpay_payment_link_id,
      razorpay_payment_link_reference_id,
      razorpay_payment_link_status,
      razorpay_payment_id
    ].join("|");

    const expectedSignature =
      sign(
        signedValue,
        secret
      );

    if (
      !safeEqual(
        expectedSignature,
        razorpay_signature
      )
    ) {
      return res
        .status(400)
        .send("Invalid Razorpay signature");
    }

    const payload =
      Buffer
        .from(
          JSON.stringify({
            payment_id:
              razorpay_payment_id,

            link_id:
              razorpay_payment_link_id,

            reference_id:
              razorpay_payment_link_reference_id,

            exp:
              Date.now() +
              10 * 60 * 1000
          })
        )
        .toString("base64url");

    const tokenSignature =
      sign(
        payload,
        tokenSecret
      );

    const token =
      payload +
      "." +
      tokenSignature;

    return res.redirect(
      "https://skkgnteam.in/?payment=verified&token=" +
      encodeURIComponent(token)
    );

  } catch (e) {

    console.error(e);

    return res
      .status(500)
      .send("Payment verification error");

  }

};