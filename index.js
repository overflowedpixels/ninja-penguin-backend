const express = require("express");
const fs = require("fs");
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");
const cors = require("cors");
const nodemailer = require("nodemailer");
const DocxMerger = require("docx-merger");
const { log } = require("console");
const ImageModule = require("docxtemplater-image-module-free");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ================= EMAIL CONFIG =================

const EMAIL_USER = "overflowedpixels@gmail.com";
const EMAIL_PASS = "osavmoezpkvooyhp";

const transporter = nodemailer.createTransport({
  service: "gmail",
  port: 465,
  secure: true,
  family: 4, 
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS,
  },
});

// ================= CONFIG =================

// 👇 CHANGE THESE TO MATCH YOUR DOCX
const ROWS_PER_COLUMN = 35;   // height of one column
const TOTAL_COLUMNS = 5;    // number of columns in template2

// ================= HELPERS =================

 

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

// ================= API =================

app.post("/test", async (req, res) => {
  try {
    // Load DOCX templates
    let file1 = fs.readFileSync("template1.docx", "binary");
    let file2 = fs.readFileSync("template2.docx", "binary");
    let file3 = fs.readFileSync("template3.docx", "binary");
    let isGreater = false;

    console.log(req.body);
    const imageModule = new ImageModule({
      centered: true,
      getImage: async (tagValue) => {
        const res = await axios.get(tagValue, {
        responseType: "arraybuffer",
      });
      return Buffer.from(res.data);
    },
  getSize: () => [200, 150],
    });
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
      modules: [imageModule],
    });

    console.log("Images:", req.body.sitePictures);

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

    merger.save("nodebuffer", async (data) => {
      try {
        await transporter.sendMail({
          from: EMAIL_USER,
          to: "penguinninja8@gmail.com",
          subject: "Document",
          text: "Here is your document",
          attachments: [
            {
              filename: "document.docx",
              content: data,
            },
          ],
        });

        console.log("Email sent successfully");
        await transporter.sendMail({
          from: EMAIL_USER,
          to: req.body.EPC_Email,
          subject: "Request has been Approved",
          text: `Hello ${req.body.EPC_Name},\n\nYour request has been approved.\n\nRegards,\nTeam TrueSun`,
        });
        return res.status(200).json({
          message: "Document generated and sent successfully",
          success: true,
        });

      } catch (emailErr) {
        console.error("Email Error:", emailErr);

        return res.status(500).json({
          success: false,
          error: "Document generated but email failed",
          details: emailErr.message,
        });
      }
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
    await transporter.sendMail({
      from: EMAIL_USER,
      to: email,
      subject: "Request Rejected - Service Integrator Portal",
      text: `Hello ${name},\n\nYour request has been rejected for the following reason:\n\n${reason}\n\nRegards,\nAdmin Team`,
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



