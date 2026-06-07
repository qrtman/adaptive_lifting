import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';

// Load the API Key from the environment
const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error('[Agent Gamma] ERROR: GEMINI_API_KEY environment variable is missing.');
  console.error('Please run: set GEMINI_API_KEY=your_key_here && npx tsx orchestrator.ts');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

const SPECS_PATH = path.join(process.cwd(), 'docs', 'specs.md');
const DRAFT_CODE_PATH = path.join(process.cwd(), 'src', 'draft.tsx');
const QA_REPORT_PATH = path.join(process.cwd(), 'qa', 'report.json');

const ACTIVE_COMPONENT_PATH = path.join(process.cwd(), 'src', 'components', 'DashboardPlaceholders.tsx');

const MAX_LOOPS = 3;

async function runBuilder(specs: string, previousFeedback: string = ""): Promise<string> {
  console.log('\n[Agent Alpha - Builder]: Analyzing specs and writing raw React TSX code...');
  let prompt = `You are Agent Alpha, an elite Senior Frontend Engineer with absolute creative freedom.\n\nHere are the user's requirements:\n${specs}\n\n`;
  if (previousFeedback) {
    prompt += `PREVIOUS JUDGE REJECTION FEEDBACK:\n${previousFeedback}\n\nPlease fix the logic and UX issues mentioned above.\n\n`;
  }
  prompt += `Your task is to completely rewrite the Dashboard UI. You have full freedom to invent new layouts, use raw CSS/Tailwind, and write complex React functional components.

OUTPUT REQUIREMENTS:
Output ONLY raw valid TypeScript/React (.tsx) code. 
Do NOT wrap the code in markdown blocks like \`\`\`tsx. Just output the raw code starting with import statements.
Ensure the component is exported as \`export const DashboardPlaceholders: React.FC = () => { ... }\`.`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: { temperature: 0.4 }
  });

  return response.text?.trim() || "";
}

async function runJudge(specs: string, draftCode: string): Promise<{ STATUS: string, FEEDBACK?: string }> {
  console.log('\n[Agent Beta - Judge]: Evaluating TSX code creativity and structural UX...');
  const prompt = `You are Agent Beta, a Creative Director and Senior Code Reviewer.\n\nUSER REQUIREMENTS:\n${specs}\n\nBUILDER OUTPUT (TSX CODE):\n${draftCode}\n\nEvaluate the Builder's code. Does it achieve stunning visual excellence? Does it use creative spacing, padding, and layout (instead of boring, rigid constraints)? Are there any syntax errors?\nIf perfect, output ONLY valid JSON: { "STATUS": "APPROVED" }\nIf flawed or boring, output ONLY valid JSON: { "STATUS": "REJECTED", "FEEDBACK": "Detailed reason here" }\nDo not output markdown code blocks.`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: { temperature: 0.2 }
  });

  try {
    const rawJson = response.text?.replace(/^```json/m, '').replace(/^```/m, '').trim() || "{}";
    return JSON.parse(rawJson);
  } catch (err) {
    return { STATUS: "REJECTED", FEEDBACK: "Judge failed to parse LLM evaluation JSON." };
  }
}

async function orchestrate() {
  console.log('[Agent Gamma - Orchestrator]: Booting Full-Freedom Multi-Agent TSX Loop...');

  if (!fs.existsSync(SPECS_PATH)) {
    console.error(`[Agent Gamma] ERROR: Requirements file not found at ${SPECS_PATH}`);
    process.exit(1);
  }

  const specs = fs.readFileSync(SPECS_PATH, 'utf-8');
  let loopCount = 0;
  let feedback = "";
  let finalCodeString = "";

  while (loopCount < MAX_LOOPS) {
    console.log(`\n=== STATE: BUILDER_REVIEW (Loop ${loopCount + 1}/${MAX_LOOPS}) ===`);
    
    // 1. Builder generates TSX code
    const builderOutput = await runBuilder(specs, feedback);
    
    // Strip markdown code blocks if the LLM hallucinated them
    const cleanCode = builderOutput.replace(/^```tsx/m, '').replace(/^```/m, '').trim();
    
    if (!cleanCode.includes('import') || !cleanCode.includes('export')) {
      console.log(`[Agent Alpha]: Output was not valid TSX code. Retrying...`);
      feedback = "Your last output was not valid code. You must output raw code with imports and exports.";
      loopCount++;
      continue;
    }

    fs.writeFileSync(DRAFT_CODE_PATH, cleanCode);
    finalCodeString = cleanCode;

    console.log(`=== STATE: JUDGE_EVAL ===`);
    
    // 2. Judge evaluates the code
    const report = await runJudge(specs, finalCodeString);
    fs.writeFileSync(QA_REPORT_PATH, JSON.stringify(report, null, 2));

    if (report.STATUS === 'APPROVED') {
      console.log(`\n[Agent Gamma]: ✅ Judge APPROVED the code design!`);
      break;
    } else {
      console.log(`\n[Agent Gamma]: ❌ Judge REJECTED! Feedback: ${report.FEEDBACK}`);
      feedback = report.FEEDBACK || "";
      loopCount++;
    }
  }

  console.log(`\n=== STATE: COMPLETE ===`);
  if (loopCount >= MAX_LOOPS) {
    console.log(`[Agent Gamma] WARNING: Max loops reached. Applying latest draft code anyway.`);
  }

  // 3. Promote drafts to active component
  if (fs.existsSync(DRAFT_CODE_PATH)) {
    fs.copyFileSync(DRAFT_CODE_PATH, ACTIVE_COMPONENT_PATH);
    console.log(`[Agent Gamma] Hot-reloaded DashboardPlaceholders.tsx with new AI Code!`);
  }

  console.log('[Agent Gamma] Orchestration run complete.');
}

orchestrate().catch(err => {
  console.error('[Agent Gamma] Fatal error:', err);
});
