import { GoogleGenAI } from '@google/genai';
import puppeteer from 'puppeteer';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('ERROR: GEMINI_API_KEY is missing.');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

async function runVisualQA() {
  console.log('[👁️ Visual QA] Launching headless browser...');
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  // Set viewport to a wide desktop resolution
  await page.setViewport({ width: 1600, height: 1000 });

  console.log('[👁️ Visual QA] Navigating to http://localhost:3005/ ...');
  try {
    await page.goto('http://localhost:3005/', { waitUntil: 'networkidle0', timeout: 10000 });
  } catch (e) {
    console.log('[👁️ Visual QA] Warning: navigation timeout, proceeding anyway.');
  }

  // Wait for any animations to finish
  await new Promise(r => setTimeout(r, 2000));

  console.log('[👁️ Visual QA] Taking screenshot...');
  const screenshotBuffer = await page.screenshot({ type: 'png', fullPage: false });
  await browser.close();

  const base64Image = screenshotBuffer.toString('base64');

  console.log('[👁️ Visual QA] Sending screenshot to Gemini 2.5 Pro for ruthless UI critique...');
  
  const prompt = `You are an elite, ruthless UX/UI Director reviewing the 'Obsidian Kinetic' dashboard.
The developer has implemented a masonry bento grid using Tailwind CSS v4.

Look at the screenshot of the live frontend. 
Your job is to identify ANY visual flaws:
- Overlapping text
- Bad proportions
- Weird scrolling or clipping
- Double borders or nested boxes
- Ugly default scrollbars
- Misaligned components

Be extremely specific and ruthless. Output a list of EXACT code fixes we need to make (e.g., "In App.tsx, the Telegram Simulator container needs justify-center"). 
Do not write the code for me, just give me the absolute precision diagnostics so I can fix it immediately.`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      prompt,
      {
        inlineData: {
          mimeType: 'image/png',
          data: base64Image
        }
      }
    ],
    config: { temperature: 0.2 }
  });

  console.log('\n========================================');
  console.log('         🎨 VISUAL QA REPORT 🎨         ');
  console.log('========================================\n');
  console.log(response.text);
  console.log('\n========================================');
}

runVisualQA().catch(console.error);
