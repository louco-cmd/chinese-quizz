const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS
  }
});

async function sendVerificationEmail(email, token) {
  const link = `http://localhost:3000/auth/verify-email?token=${token}`;

  await transporter.sendMail({
    to: email,
    subject: 'Finish setting up your Jiāyóu account',
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Verify your email</title>
</head>
<body style="margin:0; padding:0; background-color:#f8f9fa; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" style="padding: 24px 0;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 520px; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); overflow: hidden;">
          
          <!-- Header -->
          <tr>
            <td style="padding: 24px; text-align: center; background-color: #0d6efd; color: white;">
              <h1 style="margin: 0; font-size: 28px; font-weight: 700;">加油!</h1>
              <p style="margin: 8px 0 0; font-size: 14px; opacity: 0.9;">
                Learn Chinese in the real world
              </p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 32px 28px; color: #212529;">
              <h2 style="margin-top: 0; font-size: 20px; font-weight: 600;">
                Almost there 👋
              </h2>

              <p style="font-size: 15px; line-height: 1.6; margin-bottom: 24px;">
                Finish setting up your account by confirming your email address.
              </p>

              <!-- Button -->
              <div style="text-align: center; margin: 32px 0;">
                <a href="${link}"
                  style="
                    display: inline-block;
                    padding: 14px 28px;
                    background-color: #0d6efd;
                    color: #ffffff;
                    text-decoration: none;
                    font-weight: 600;
                    border-radius: 8px;
                    font-size: 15px;
                  ">
                  Confirm my email
                </a>
              </div>

              <p style="font-size: 14px; color: #6c757d; line-height: 1.5;">
                If you didn’t request this, you can safely ignore this email.
              </p>

              <p style="font-size: 13px; color: #adb5bd; margin-top: 32px;">
                This link will expire in 24 hours.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px; text-align: center; font-size: 12px; color: #6c757d; background-color: #f1f3f5;">
              © ${new Date().getFullYear()} Jiāyóu — All rights reserved
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>
    `
  });
}

module.exports = {
  sendVerificationEmail
};
