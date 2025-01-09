const express = require('express');
const multer = require('multer');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const socketIo = require('socket.io');
const http = require('http');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const csvStringify = require('csv-stringify');
const stringify = require('csv-stringify/lib/sync');  // Import the synchronous version
puppeteer.use(StealthPlugin());
const { google } = require('googleapis');
const vision = require('@google-cloud/vision');
const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const { Configuration, OpenAIApi } = require("openai");
const OpenAI = require('openai');
const axios = require('axios');
const sheetsV4 = google.sheets('v4');

// Multer setup for file uploads
const upload = multer({ dest: 'uploads/' });
console.log (puppeteer.executablePath());
// Serve static files (like your HTML file)
app.use(express.static('public'));

app.get('/download', (req, res) => {
  const filePath = path.join(__dirname, 'images4.tar.gz');
  console.log('File Path:', filePath);

  res.download(filePath, 'images4.tar.gz', (err) => {
      if (err) {
          console.error('Error downloading file:', err);
      }
  });
});

// Handle file upload and start scraping process
app.post('/process', upload.single('fileInput'), async (req, res) => {
  const socketId = req.headers['socket-id'];

  if (!req.file) {
    io.to(socketId).emit('log', { message: 'No file uploaded.' });
    return res.status(400).json({ error: 'No file uploaded' });
  }



  const filePath = path.join(__dirname, 'uploads', req.file.filename);

  // Read the CSV file
  const data = [];
  fs.createReadStream(filePath)
    .pipe(csv())
    .on('data', (row) => {
      data.push(row);
    })
    .on('end', async () => {
      io.to(socketId).emit('log', { message: 'File successfully read.' });
      
      const set_name = data[0]['Set'];
      const grade_value = data[0]['Grade'];

      // Start scraping process with Puppeteer
      try {
        await scrapeData(set_name, grade_value, socketId, data);
        io.to(socketId).emit('log', { message: 'Scraping completed successfully.' });
        fs.unlinkSync(filePath);  // This will delete the uploaded file

      } catch (error) {
        io.to(socketId).emit('log', { message: `Error during scraping: ${error.message}` });
        return res.status(500).json({ error: 'Scraping failed' });
      }
    });
});


function generateCSVAndSend(data, socketId) {
    try {
        // Generate CSV in memory
        const csvOutput = stringify(data, { header: true });

        // Emit the CSV data to the client for download
        io.to(socketId).emit('file_data', {
            filename: 'updated_file.csv',
            data: csvOutput
        });
    } catch (err) {
        io.to(socketId).emit('log', { message: `Error generating CSV file. ${err.message}` });
    }
}
// Scraping logic using Puppeteer
async function scrapeData(set_name,grade_value, socketId, data) {

    function delay(time) {
        return new Promise(function(resolve) { 
          setTimeout(resolve, time);
        });
      }
      const browser = await puppeteer.launch({
        product: 'firefox',
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu',
        ],
      });
      
      
      const page = await browser.newPage();

      await page.screenshot({ path: 'initial-load.png', fullPage: true });

  // Go to the site
  await page.goto("https://www.psacard.com/auctionprices", { waitUntil: 'networkidle2', timeout: 60000 });
  io.to(socketId).emit('log', { message: `Navigated to search results for set: ${set_name}` });

  // Enter the set name into the search field
  await page.type('#search', set_name);

  await page.screenshot({ path: 'searching.png', fullPage: true });

  await delay(2000);
  await page.focus('#search'); // Focus on the search input (optional if #search is already focused)
  await page.keyboard.press('Enter');
  io.to(socketId).emit('log', { message: `Searching for set: ${set_name}` });

  await delay(3000);

  await page.screenshot({ path: 'after-search.png', fullPage: true });


  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const baseballButton = buttons.find(button => button.textContent.trim() === 'Baseball Cards');
    if (baseballButton) 
      {
        baseballButton.click();
    }
    else {
      console.log("Baseball button not found")
    }
  });
  io.to(socketId).emit('log', { message: `Bsaseball button clicked` });

  await delay(5000);
  await page.screenshot({ path: 'after-baseball.png', fullPage: true });

  const elementExists = await page.$('table.w-full.border.border-neutralstroke2 tbody tr:first-child td:first-child a') !== null;
  console.log('Element exists:', elementExists);

  await page.waitForSelector('table.w-full.border.border-neutralstroke2 tbody tr:first-child td:first-child a',{ timeout: 30000 });

  await page.click('table.w-full.border.border-neutralstroke2 tbody tr:first-child td:first-child a');
  io.to(socketId).emit('log', { message: 'Clicked on the first item link.' });



  await delay(5000);
  await page.screenshot({ path: 'after-first-link.png', fullPage: true });

  // Locate the breadcrumb link containing the set name
const breadcrumbLinks = await page.$$('ul.flex.items-center.gap-x-2 li a');

let found = false;

for (let link of breadcrumbLinks) {
    const text = await page.evaluate(el => el.textContent.trim(), link);
    if (text.toLowerCase().includes(set_name.toLowerCase())) {
        await link.click();
        io.to(socketId).emit('log', { message: `Clicked on the breadcrumb link for '${set_name}'.` });
        found = true;
        break;
    }
}

if (!found) {
    io.to(socketId).emit('log', { message: `Set name '${set_name}' not found in breadcrumbs.` });
}

await delay(5000);
await page.screenshot({ path: 'after-breadcrumbs-link.png', fullPage: true });


  // Select the grade
// Select the grade using a CSS selector
// Click to open the dropdown menu
await page.click('button[aria-haspopup="true"]');
io.to(socketId).emit('log', { message: 'Opened the grade dropdown.' });
await delay(1000);

// Wait for the dropdown menu to appear
await page.waitForSelector('div[role="menu"] a', { visible: true });

// Select the desired grade from the dropdown
const gradeOptions = await page.$$('div[role="menu"] a');
let gradeFound = false;

for (let option of gradeOptions) {
    const text = await page.evaluate(el => el.textContent.trim(), option);

    // Debugging log to ensure correct options are loaded
    io.to(socketId).emit('log', { message: `Found grade option: ${text}` });

    if (text.toLowerCase() === grade_value.toLowerCase()) {
        await option.click();
        io.to(socketId).emit('log', { message: `Selected grade: ${grade_value}.` });
        gradeFound = true;
        break;
    }
}

if (!gradeFound) {
    io.to(socketId).emit('log', { message: `Grade '${grade_value}' not found in dropdown.` });
}

await delay(5000);

await page.screenshot({ path: 'after-grade.png', fullPage: true });




const searchBox2 = await page.$("input#search-set");
  if (!searchBox2) {
    io.to(socketId).emit('log', { message: `Search box not found` });

  }

// Initialize a Set to track processed players
const processedPlayers = new Set();

for (const row of data) {
    const player_name = row['Player'];
    const set_name = row['Set'];
    const grade_value = row['Grade'];

    // Skip processing if player_name is missing or has already been processed
    if (!player_name || processedPlayers.has(player_name)) {
      io.to(socketId).emit('log', { message: `Skipping row due to missing player name or already processed: ${player_name || 'Unknown Player'}` });
      continue;  // Skip to the next player
  }

try {

        // Check if the search box exists
  const searchBox = await page.$("input#search-set");
  let rows = [];

if (searchBox) {
  await searchBox.click();
  await page.keyboard.down('Control');
  await page.keyboard.press('A');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await delay(1000);

  // Type the player name into the search box
  await page.type("input#search-set", player_name);
  io.to(socketId).emit('log', { message: `Searching for player: ${player_name}` });
  await delay(3000); // Allow time for the search results to load
  await page.screenshot({ path: 'after-input-playername.png', fullPage: true });

  // Retrieve rows from the results table
  rows = await page.$$('table.w-full tbody tr');
  io.to(socketId).emit('log', { message: `Found ${rows.length} results.` });
} else {
    // Additional logic if search box is not found
     rows = await page.$$('table.w-full tbody tr');
    await delay(2000);  // Adding delay to let the page load results

    // Filter rows manually if no search box
    const playerWords = player_name.split(' ').map(word => word.toLowerCase());
    let filteredRows = [];
    for (let row of rows) {
      const rowText = await row.$eval('td:nth-child(2) a', el => el.textContent.trim().toLowerCase());
      const rowWords = rowText.split(' ');
        
        // Check if at least two words from the player's name match with the row text
        const matches = playerWords.filter(word => rowWords.includes(word));
        if (matches.length >= 2) {
            filteredRows.push(row); // Keep this row as it partially matches
        }
    }
         // Update the rows variable to only process filtered rows
    if (filteredRows.length > 0) {
      io.to(socketId).emit('log', { message: `Found matching rows for player: ${player_name}` });
      rows = filteredRows;  // Replace rows with filtered rows
  } else {
      io.to(socketId).emit('log', { message: `No matching rows found for player: ${player_name}` });
  } 
  }
        // Locate the table body and retrieve rows
        await delay(2000);  // Adding delay to let the page load results

        if (rows.length > 0) {
            let first_row = true;  // Flag to update only the first row
            const existingPlayerIndex = data.findIndex(item => item['Player'] === player_name);

            if (existingPlayerIndex !== -1) {
                for (let row of rows) {
                  const number = await row.$eval('td:nth-child(1)', el => el.textContent.trim());
                  const recent_price = await row.$eval('td:nth-child(3)', el => el.textContent.trim());
                    const avg_price = await row.$eval('td:nth-child(4)', el => el.textContent.trim());

                    if (first_row) {
                        // Update the first row for the player
                        data[existingPlayerIndex]['Number'] = number;
                        data[existingPlayerIndex]['Recent Price'] = recent_price;
                        data[existingPlayerIndex]['Average Price'] = avg_price;
                        io.to(socketId).emit('log', { message: `Updating row for Player: ${player_name}, Number: ${number}` });
                        first_row = false;  // Only update once
                    } else {
                        // Insert additional rows for the player
                        data.push({
                            'Player': player_name,
                            'Set': set_name,
                            'Grade': grade_value,
                            'Number': number,
                            'Recent Price': recent_price,
                            'Average Price': avg_price
                        });
                        io.to(socketId).emit('log', { message: `Inserting row for Player: ${player_name}, Number: ${number}` });
                    }
                }
            }

            // Mark the player as processed after handling all rows
            processedPlayers.add(player_name);
        } else {
            io.to(socketId).emit('log', { message: `No data found for player: ${player_name}` });
        }
    } catch (error) {
        io.to(socketId).emit('log', { message: `Error processing player ${player_name}: ${error.message}` });
    }
}



  await browser.close();

  // Save the updated data into CSV
  generateCSVAndSend(data, socketId);
}

// Socket.io connection handler
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  socket.emit('connected', { message: 'Connected to server' });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

const keyFile = './creden.json';


const  apiKey = process.env.OPENAI_API_KEY ||'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'; // Replace with your OpenAI API key


/**
 * Encode image as base64
 * @param {string} imagePath - The path to the image file
 * @returns {string} - Base64 encoded image
 */

function encodeImageToBase64(imagePath) {
  const image = fs.readFileSync(imagePath);
  return image.toString('base64');
}



async function createGoogleSheet(auth, sheetTitle) {
  const sheetsService = google.sheets({ version: 'v4', auth });

  // Create a new spreadsheet
  const newSheet = await sheetsService.spreadsheets.create({
      resource: {
          properties: {
              title: sheetTitle, // Set the title of the new sheet
          },
          sheets: [
              {
                  properties: {
                      title: 'Sheet1',
                  },
                  data: [
                      {
                          startRow: 0,
                          startColumn: 0,
                          rowData: [
                              {
                                  values: [{ userEnteredValue: { stringValue: 'Player Name' } }, 
                                  { userEnteredValue: { stringValue: 'Set Name' } },     // Header for Set Name
                                  { userEnteredValue: { stringValue: 'Grade' } } ] // Set the column header
                              },
                          ],
                      },
                  ],
              },
          ],
      },
  });

  return newSheet.data;
}


async function generateShareableLink(driveService, fileId) {
  await driveService.permissions.create({
      fileId: fileId,
      resource: {
          role: 'writer',
          type: 'anyone', // Allow anyone to read
      },
  });

  const file = await driveService.files.get({
      fileId: fileId,
      fields: 'webViewLink',
  });

  return file.data.webViewLink;
}


app.post('/extract-player', upload.array('fileInput'), async (req, res) => {
  const socketId = req.headers['socket-id'];

  try {

        const setName = req.body.setName;
        const grade = req.body.grade;

      if (!req.files || req.files.length === 0) {
          return res.status(400).json({ error: 'No files uploaded' });
      }
        console.log(req.files);
      const allPlayerNames = [];
      io.to(socketId).emit('log', { message: `Total Image Files: ${req.files.length}.` });

      // Process images in batches (adjust batch size if needed)
      const batchSize = 5; // Number of images to process at a time
      const imageBatches = [];

      for (let i = 0; i < req.files.length; i += batchSize) {
          imageBatches.push(req.files.slice(i, i + batchSize));
      }
      io.to(socketId).emit('log', { message: `Processing in batches of ${batchSize}. Total Batches: ${imageBatches.length}.` });

      // Loop through each batch
      for (const [index, batch] of imageBatches.entries()) {
        io.to(socketId).emit('log', { message: `Processing Batch ${index + 1} of ${imageBatches.length}.` });
        const messages = [
          {
              role: 'user',
              content: [
                  {
                      type: "text",
                      text: "Please carefully extract only the full names of the baseball players visible on these card images. IMPORTANT: The Number of PLayers names should be exactly same as NUmber of Cards are in the Attached Images, For example if one pic has 9 cards and there are 4 images attached then 36 players names is correct output considering No Dublicate. Ensure that only the names of players are included—avoid any extra text, such as positions, team names, or any other labels. Return the names in a clean, comma-separated list format, with no additional information or formatting."
                  }
              ]
          }
      ];
      io.to(socketId).emit('log', { message: `Sending Batch ${index + 1} to GPT-4.` });

          // Prepare the batch for GPT-4 Vision
          // Prepare each image in the batch
    for (const file of batch) {
      const filePath = path.join(__dirname, 'uploads', file.filename);
      const base64Image = encodeImageToBase64(filePath);

      // Add each image as part of the `content` array inside the same `user` message
      messages[0].content.push({
          type: "image_url",
          image_url: {
              url: `data:image/jpeg;base64,${base64Image}`
          }
      });
  }
          io.to(socketId).emit('log', { message: `Batch ${index + 1} processed. Extracting player names.` });
          
          
          // Send the batch to GPT-4 Vision API
          const gptResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
              model: 'gpt-4o-mini', // Use the correct chat model with vision capabilities
              messages: messages,
              max_tokens: 300, // Increase max_tokens if needed for longer lists
              temperature: 0.5,
          }, {
              headers: {
                  'Authorization': `Bearer ${apiKey}`,
                  'Content-Type': 'application/json'
              }
          });

          const gptOutput = gptResponse.data.choices[0].message.content.trim();
          const playerNames = gptOutput.split(',').map(name => name.trim());

          // Collect all the player names
          allPlayerNames.push(...playerNames);
          io.to(socketId).emit('log', { message: `Batch ${index + 1} completed. Player names extracted.` });

          // Optionally, clean up the uploaded files after processing
          batch.forEach(file => fs.unlinkSync(path.join(__dirname, 'uploads', file.filename)));

      }

       // Authenticate Google Sheets API
       const auth = new google.auth.GoogleAuth({
        keyFile: keyFile, // Path to your service account key file
        scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
    });
    const authClient = await auth.getClient();
    io.to(socketId).emit('log', { message: 'Creating a new Google Sheet.' });

    // Create a new Google Sheet
    const sheetTitle = 'Player Names - Extracted';
    const newSheet = await createGoogleSheet(authClient, sheetTitle);

    // Append player names to the newly created sheet
    const spreadsheetId = newSheet.spreadsheetId;
    // Append player names, set name, and grade to the newly created sheet
await sheetsV4.spreadsheets.values.append({
  auth: authClient,
  spreadsheetId: spreadsheetId,
  range: 'Sheet1!A2:C', // Adjust the range to include three columns: Player Name, Set Name, and Grade
  valueInputOption: 'USER_ENTERED',
  resource: {
      values: allPlayerNames.map(name => [name, setName, grade]), // Add setName and grade to each row
  },
});

    io.to(socketId).emit('log', { message: 'Generating a shareable link for the Google Sheet.' });

    // Generate a shareable link
    const webViewLink = await generateShareableLink(google.drive({ version: 'v3', auth: authClient }), spreadsheetId);
    io.to(socketId).emit('log', { message: `Player names added to Google Sheet. Link: ${webViewLink}` });
    // Send back the link to the user
    clearUploadsFolder();

    res.status(200).json({ message: 'Player name extraction complete!', link: webViewLink });

} catch (error) {
    console.error('Error during extraction:', error);
    io.to(socketId).emit('log', { message: `Error during extraction: ${error.message}` });
    clearUploadsFolder();

    res.status(500).json({ error: 'Error during extraction' });
}
});


const clearUploadsFolder = () => {
  const directory = path.join(__dirname, 'uploads');
  fs.readdir(directory, (err, files) => {
      if (err) {
          console.error(`Error reading uploads directory: ${err.message}`);
          return;
      }
      for (const file of files) {
          fs.unlink(path.join(directory, file), (err) => {
              if (err) console.error(`Error deleting file ${file}: ${err.message}`);
          });
      }
  });
};

