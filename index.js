const express = require("express");
const fs = require("fs");
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");
const cors = require("cors");
const DocxMerger = require("docx-merger");
const { log } = require("console");
const ImageModule = require("docxtemplater-image-module-free");
const axios = require("axios");
require("dotenv").config();
const app = express();
app.use(cors());
const JSZip = require("jszip");
app.use(express.json({ limit: "10mb" }));

// ================= EMAIL CONFIG =================

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";
const EMAIL_USER = "codewizard368@gmail.com";

// Helper function to send email via Brevo
async function sendBrevoEmail(payload) {
  if (!process.env.BREVO_API_KEY) {
    console.error("BREVO_API_KEY is missing via .env");
    return;
  }

  try {
    const response = await axios.post(
      BREVO_API_URL,
      payload,
      {
        headers: {
          "api-key": process.env.BREVO_API_KEY,
          "content-type": "application/json",
          "accept": "application/json",
        },
      }
    );
    console.log("Brevo API Response:", response.data);
    return response.data;
  } catch (error) {
    console.error("Brevo API Error:", error.response ? error.response.data : error.message);
    throw error;
  }
}

// ================= CONFIG =================

// 👇 CHANGE THESE TO MATCH YOUR DOCX
const ROWS_PER_COLUMN = 35;   // height of one column
const TOTAL_COLUMNS = 5;    // number of columns in template2

// ================= HELPERS =================

const getImageModule = () => new ImageModule({
  centered: true,
  getImage: async (tagValue) => {
    // tagValue = URL
    const res = await axios.get(tagValue, {
      responseType: "arraybuffer",
    });
    return Buffer.from(res.data);
  },

  getSize: () => [200, 150], // adjust
});

// Column-wise transformer
function columnWiseTable(data, rowsPerCol, cols) {
  const table = [];

  for (let r = 0; r < rowsPerCol; r++) {
    const row = {};
    for (let c = 0; c < cols; c++) {
      const index = c * rowsPerCol + r;
      row[`c${c}`] = data[index] || "";
    }
    table.push(row);
  }

  return table;
}

// Split data into pages
function splitIntoPages(data, pageSize = 175) {
  const pages = [];
  for (let i = 0; i < data.length; i += pageSize) {
    pages.push(data.slice(i, i + pageSize));
  }
  return pages;
}

async function compressDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer);

  return await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 } // max compression
  });
}
// ================= API =================

app.post("/test", async (req, res) => {

  try {
    // Load DOCX templates
    let file1 = fs.readFileSync("template1.docx", "binary");
    let file2 = fs.readFileSync("template2.docx", "binary");
    let file3 = fs.readFileSync("template3.docx", "binary");
    let isGreater = false;

    console.log(req.body);

    if (req.body.serialNumbers && req.body.serialNumbers.length > 50) {
      isGreater = true;
      // ---------------- TEMPLATE 1 ----------------
      let SerialBefore50 = req.body.serialNumbers.slice(0, 50);
      let remainingSerialNumbers = req.body.serialNumbers.slice(50);
      let serial = req.body
      for (let i = 0; i < SerialBefore50.length; i++) {
        serial[`Serial_No${i + 1}`] = SerialBefore50[i];
      }
      const zip1 = new PizZip(file1);
      const doc1 = new Docxtemplater(zip1, {
        paragraphLoop: true,
        linebreaks: true,
      });

      doc1.render(serial);



      file1 = doc1.getZip().generate({
        type: "nodebuffer",
        compression: "DEFLATE",
      });

      // ---------------- TEMPLATE 2 ----------------

      if (remainingSerialNumbers.length > 0) {

        const PAGE_LIMIT = 175;

        const pages = splitIntoPages(remainingSerialNumbers, PAGE_LIMIT);

        const pagedTables = pages.map((pageData, pageIndex) => {
          return {
            pageBreak: pageIndex > 0, // true for 2nd page onwards
            table: columnWiseTable(pageData, ROWS_PER_COLUMN, TOTAL_COLUMNS),
          };
        });


        const zip2 = new PizZip(file2);
        const doc2 = new Docxtemplater(zip2, {
          paragraphLoop: true,
          linebreaks: true,
        });

        doc2.render({
          pages: pagedTables
        });

        file2 = doc2.getZip().generate({
          type: "nodebuffer",
          compression: "DEFLATE",
        });

      }
    } else {

      let serial = req.body
      for (let i = 0; i < 50; i++) {
        serial[`Serial_No${i + 1}`] = req.body.serialNumbers[i] ? req.body.serialNumbers[i] : "";
      }
      const zip1 = new PizZip(file1);
      const doc1 = new Docxtemplater(zip1, {
        paragraphLoop: true,
        linebreaks: true,
      });

      doc1.render(serial);

      file1 = doc1.getZip().generate({
        type: "nodebuffer",
        compression: "DEFLATE",
      });
    }


    const zip3 = new PizZip(file3);

    const doc3 = new Docxtemplater(zip3, {
      paragraphLoop: true,
      linebreaks: true,
      modules: [getImageModule()],
    });

    await doc3.renderAsync({
      images: req.body.sitePictures.map((url) => ({ img: url })),
    });

    file3 = doc3.getZip().generate({
      type: "nodebuffer",
      compression: "DEFLATE",
    });



    // ---------------- MERGE DOCS ----------------
    let fileArray = [file1, file2, file3];
    if (!isGreater) {
      fileArray.splice(1, 1);
    }
    const merger = new DocxMerger({}, fileArray);
    const mergedBuffer = await new Promise((resolve) => {
      merger.save("nodebuffer", (data) => resolve(data));
    });
    const data = await compressDocx(mergedBuffer);

    try {
      const sender = { email: process.env.SMTP_EMAIL || "no-reply@truesun.com", name: "TrueSun Onboarding" };

      // 1. Send Admin Email (with Attachment)
      // Convert buffer to Base64 for attachment
      console.log("Generating Base64 for attachment...");
      const base64Data = data.toString('base64');
      console.log(`Base64 generated. Length: ${base64Data.length}`);

      console.log("Sending Admin Email...");
      const adminEmailPayload = {
        sender: sender,
        to: [{ email: "overflowedpixels@gmail.com", name: "Admin" }],
        subject: "A new Request",
        htmlContent: `
<!DOCTYPE html>
<html>
  <body style="font-family: Arial, sans-serif; line-height:1.6;">
    <p>Dear Premier Energies,</p>

    <p>
      We request you to kindly issue the warranty certificate for the mentioned request.
    </p>

    <p>
      Please let us know if any additional information or documents are required from our side.
    </p>

    <p>
      Looking forward to your support.
    </p>

    <p>
      Best regards,<br>
    </p>
  </body>
</html>
`
        ,
        attachment: [
          {
            content: base64Data,
            name: "document.docx"
          }
        ]
      };
      // console.log("Admin Email Payload:", JSON.stringify(adminEmailPayload, null, 2));

      await sendBrevoEmail(adminEmailPayload);
      console.log("Admin Email sent successfully.");

      // 2. Send User Approval Email (if EPC_Email exists)
      if (req.body.EPC_Email) {
        console.log("Sending User Email...");
        await sendBrevoEmail({
          sender: sender,
          to: [{ email: req.body.EPC_Email, name: req.body.EPC_Per }], // Using EMAIL_USER as per original logic
          subject: "Request Approved",
          htmlContent: `
<!DOCTYPE html>
<html>
  <body style="font-family: Arial, sans-serif; line-height:1.6;">

    <p>Dear ${req.body.EPC_Per},</p>

    <p>
      This is to confirm that the warranty certificate request has been submitted.
    </p>

    <p>
      <strong>Warranty Number:</strong> ${req.body.WARR_No}
    </p>

    <p>
      We will share the warranty certificate with you once it is received.<br>
      Please feel free to reach out in case of any queries.
    </p>

    <p>
      Best regards,<br>
      Team TrueSun
    </p>

  </body>
</html>
`

        });
      }

    } catch (emailErr) {
      console.error("Email sending failed (Exception):", emailErr);
    }

    // Return success with file data
    return res.status(200).json({
      message: "Document generated successfully (Email attempt made)",
      success: true,
    });


  } catch (err) {
    console.error("Server Error:", err);
    res.status(500).json({
      error: "Failed to generate document",
      details: err.message,
    });
  }
});

app.post("/send-rejection-email", async (req, res) => {
  const { email, name, reason } = req.body;

  try {
    const sender = { email: process.env.SMTP_EMAIL || "no-reply@truesuntradingcompany.com", name: "TrueSun" };

    if (process.env.BREVO_API_KEY) {
      await sendBrevoEmail({
        sender: sender,
        to: [{ email: email, name: name }], // Using EMAIL_USER from variable
        subject: "Request Rejected",
        htmlContent: `
<!DOCTYPE html>
<html>
  <body style="font-family: Arial, sans-serif; line-height:1.6;">

    <p>Dear ${name},</p>

    <p>
      We regret to inform you that the submitted warranty certificate request has been rejected due to incorrect or incomplete details.
    </p>

    <p>
      <strong>Reason:</strong> ${reason}
    </p>

    <p>
      Kindly review the document, correct the mentioned discrepancies, and resubmit the revised warranty certificate at the earliest for further processing.
    </p>

    <p>
      Please feel free to contact us if you need any clarification.
    </p>

    <p>
      Best regards,<br>
      Team TrueSun
    </p>

  </body>
</html>
`

      });

      console.log(`Rejection email sent via API to ${email}`);
      res.status(200).json({ success: true, message: "Rejection email sent successfully" });
    } else {
      throw new Error("BREVO_API_KEY missing");
    }

  } catch (error) {
    console.error("Error sending rejection email:", error);
    res.status(500).json({ success: false, error: "Failed to send rejection email" });
  }
});

app.get("/", (req, res) => {
  res.send("I am alive");
});
// ================= START =================

app.listen(5000, () => {
  console.log("Server running on http://localhost:5000");
});