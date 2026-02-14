const express = require("express");
const fs = require("fs");
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");
const cors = require("cors");
const DocxMerger = require("docx-merger");
const { log } = require("console");
const ImageModule = require("docxtemplater-image-module-free");
const axios = require("axios");
const { Resend } = require("resend");
const app = express();
app.use(cors());
const JSZip = require("jszip");
app.use(express.json({ limit: "10mb" }));

// ================= EMAIL CONFIG =================


const EMAIL_USER = "overflowedpixels@gmail.com";
const resend = new Resend("re_T18UFtDc_PgnHizWhFcS2sf8dEGbFezMG");

console.log(resend);

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
      // Send document email via Resend
      const { data: emailData, error: emailError } = await resend.emails.send({
        from: "onboarding@resend.dev",
        to: "overflowedpixels@gmail.com",
        subject: "Hello world",
        text: "<h1>Hello world</h1>",
        attachments: [
          {
            filename: "document.docx",
            content: data,
          },
        ],
      });

      if (emailError) {
        console.error("Resend error (Document Email):", emailError);
      } else {
        console.log("Document email sent successfully:", emailData);

        // Only send approval email if document email succeeded
        if (req.body.EPC_Email) {
          const { data: approvalData, error: approvalError } = await resend.emails.send({
            from: "onboarding@resend.dev",
            to: req.body.EPC_Email,
            subject: "Request Approved",
            text: "Dear " + req.body.EPC_Per + ",\n\nYour request has been approved.\n\nAnd your warranty number is " + req.body.WARR_No + ".\n\nWe will notify you when your warranty is ready.\n\nThank you,\nTrueSun Team",
          });

          if (approvalError) {
            console.error("Resend error (Approval Email):", approvalError);
          } else {
            console.log("Approval email sent successfully:", approvalData);
          }
        }
      }

    } catch (emailErr) {
      console.error("Email sending failed (Exception):", emailErr);
      // We continue to return the file even if email fails
    }

    // Return success with file data
    return res.status(200).json({
      message: "Document generated successfully (Email attempt made)",
      success: true,
      file: data.toString("base64")
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
    await resend.emails.send({
      from: "onboarding@resend.dev",
      to: email,
      subject: "Request Rejected - Service Integrator Portal",
      text: `Hello ${name},\n\nYour request has been rejected for the following reason:\n\n${reason}\n\nRegards,\nTrueSun Team`,
    });

    console.log(`Rejection email sent to ${email}`);
    res.status(200).json({ success: true, message: "Rejection email sent successfully" });
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
