/**
 * parse-jd.mjs — LLM-powered Job Description Cleaner & Structured Extractor.
 * Zero server-side web scraping: operates strictly on client-provided raw text or Markdown.
 */

function cleanText(text) {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/[\r\t]+/g, ' ').trim();
}

/**
 * Heuristic fallback parser when no LLM API is available or if LLM call fails.
 */
export function heuristicParseJd({ text, url = '' }) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  let title = '';
  let company = '';
  let location = null;
  let salary = null;
  let employmentType = null;
  const requirements = [];

  // Attempt to parse title from header or first prominent line
  for (const line of lines.slice(0, 5)) {
    const cleanLine = line.replace(/^#+\s*/, '').trim();
    if (cleanLine.length > 3 && cleanLine.length < 100) {
      if (cleanLine.includes(' at ')) {
        const parts = cleanLine.split(' at ');
        title = parts[0].trim();
        company = parts[1].trim();
        break;
      } else if (cleanLine.includes(' | ')) {
        const parts = cleanLine.split(' | ');
        title = parts[0].trim();
        company = parts[1].trim();
        break;
      } else if (cleanLine.includes(' - ')) {
        const parts = cleanLine.split(' - ');
        title = parts[0].trim();
        company = parts[1].trim();
        break;
      } else if (!title) {
        title = cleanLine;
      }
    }
  }

  if (!company && url) {
    try {
      const parsed = new URL(url);
      const hostParts = parsed.hostname.split('.');
      company = hostParts[0] === 'jobs' || hostParts[0] === 'boards' ? hostParts[1] : hostParts[0];
      company = company.charAt(0).toUpperCase() + company.slice(1);
    } catch {}
  }

  // Location heuristics
  const locMatch = text.match(/(?:Location\s*:?|Location\b)\s*([^\n\r]+)/i);
  if (locMatch) {
    location = locMatch[1].replace(/^:\s*/, '').trim();
  } else if (/remote/i.test(text)) {
    location = 'Remote';
  }

  // Salary heuristics
  const salaryMatch = text.match(/\$[\d,]+(?:\s*-\s*\$[\d,]+|\s*k)?(?:\s*(?:\/|per)\s*(?:yr|year|hr|hour))?/i);
  if (salaryMatch) salary = salaryMatch[0].trim();

  // Requirements extraction
  let inReqs = false;
  for (const line of lines) {
    if (/^(?:requirements|qualifications|what you'?ll bring|what we'?re looking for|skills)/i.test(line)) {
      inReqs = true;
      continue;
    }
    if (inReqs && /^(?:responsibilities|benefits|about us|about the team|how to apply|compensation)/i.test(line)) {
      inReqs = false;
    }
    if (inReqs && (line.startsWith('-') || line.startsWith('•') || line.startsWith('*'))) {
      requirements.push(line.replace(/^[-•*]\s*/, '').trim());
    }
  }

  return {
    title: title || 'Job Opportunity',
    company: company || 'Company',
    location: location || null,
    salary: salary || null,
    employmentType: employmentType || (/full-time/i.test(text) ? 'Full-time' : /part-time/i.test(text) ? 'Part-time' : /contract/i.test(text) ? 'Contract' : null),
    description: text,
    requirements: requirements.slice(0, 15),
    url: url || '',
  };
}

/**
 * Call OpenRouter, OpenAI, or Gemini compatible endpoint to parse raw JD.
 */
async function callLlmParser({
  text,
  apiKey,
  model = process.env.SCORER_MODEL || 'openrouter/google/gemini-2.0-flash-exp:free',
  apiBase = process.env.OPENROUTER_API_BASE || 'https://openrouter.ai/api/v1',
}) {
  const prompt = `You are an expert AI recruiting assistant.
Extract structured job posting details from the raw job description / page markdown below.
Remove all navigation menus, header boilerplate, cookie warnings, login links, and legal disclaimers.

Return ONLY a single valid JSON object strictly matching this schema with NO markdown wrapping:
{
  "title": "Exact Role Title",
  "company": "Company Name",
  "location": "City, State or Remote or null",
  "salary": "Salary / Compensation range if mentioned or null",
  "employmentType": "Full-time / Part-time / Contract / Internship or null",
  "description": "Clean, formatted Markdown of the job description including overview, responsibilities, requirements, and benefits.",
  "requirements": ["Array of specific required skills / qualifications"]
}

--- RAW CONTENT ---
${text.slice(0, 20000)}
`;

  // Standard chat completions API
  const endpoint = `${apiBase.replace(/\/$/, '')}/chat/completions`;
  const cleanModel = model.startsWith('openrouter/') ? model.replace('openrouter/', '') : model;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://jobfoundry.local',
      'X-Title': 'JobFoundry',
    },
    body: JSON.stringify({
      model: cleanModel,
      messages: [
        {
          role: 'system',
          content: 'You extract clean structured job details from raw JD markdown. Return pure JSON only.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`LLM API responded with ${res.status}: ${errText.slice(0, 200)}`);
  }

  const json = await res.json();
  const rawContent = json?.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error('LLM returned empty message content');
  }

  // Parse JSON, handling potential markdown code fences
  const cleanJsonStr = rawContent.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed = JSON.parse(cleanJsonStr);

  return {
    title: cleanText(parsed.title) || 'Job Opportunity',
    company: cleanText(parsed.company) || 'Company',
    location: parsed.location ? cleanText(parsed.location) : null,
    salary: parsed.salary ? cleanText(parsed.salary) : null,
    employmentType: parsed.employmentType ? cleanText(parsed.employmentType) : null,
    description: parsed.description ? parsed.description.trim() : text,
    requirements: Array.isArray(parsed.requirements) ? parsed.requirements.map(cleanText).filter(Boolean) : [],
  };
}

/**
 * Primary Parse JD handler: Uses LLM when key exists, otherwise gracefully falls back to heuristic.
 */
export async function parseJobDescription({ text, markdown, url = '' }) {
  const content = (markdown || text || '').trim();
  if (!content || content.length < 15) {
    throw new Error('Content is too short or empty to parse a job description');
  }

  const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;

  if (apiKey) {
    try {
      const llmResult = await callLlmParser({ text: content, apiKey });
      return {
        ...llmResult,
        url: url || '',
      };
    } catch (err) {
      console.warn(`[Parse-JD] LLM extraction failed (${err.message}); using heuristic fallback`);
    }
  }

  // Heuristic fallback
  const fallback = heuristicParseJd({ text: content, url });
  return fallback;
}
