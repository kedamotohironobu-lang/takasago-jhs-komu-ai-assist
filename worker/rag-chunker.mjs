import { RAG_CONFIG } from './rag-config.mjs';

function cleanText(value, max = 500000) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim()
    .slice(0, max);
}

function splitSentences(text) {
  const source = cleanText(text, 500000);
  if (!source) return [];
  const parts = source
    .split(/(?<=[。！？!?])|\n+/u)
    .map(s => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [source];
}

function splitOversize(text, maxBodyChars) {
  const out = [];
  for (const sentence of splitSentences(text)) {
    if (sentence.length <= maxBodyChars) {
      out.push(sentence);
      continue;
    }
    for (let i = 0; i < sentence.length; i += maxBodyChars) {
      out.push(sentence.slice(i, i + maxBodyChars));
    }
  }
  return out;
}

function makeBodies(text) {
  const { targetChars, minChars, maxChars, overlapChars } = RAG_CONFIG.chunking;
  const maxBodyChars = Math.max(minChars, maxChars - overlapChars);
  const paragraphs = cleanText(text, 500000)
    .split(/\n{2,}/)
    .map(s => s.trim())
    .filter(Boolean)
    .flatMap(p => splitOversize(p, maxBodyChars));

  const bodies = [];
  let buf = '';

  const flush = () => {
    const v = buf.trim();
    if (v) bodies.push(v);
    buf = '';
  };

  for (const unit of paragraphs) {
    const candidate = buf ? `${buf}\n\n${unit}` : unit;
    if (candidate.length <= targetChars) {
      buf = candidate;
      continue;
    }
    if (buf && buf.length >= minChars) {
      flush();
      buf = unit;
      continue;
    }
    if (candidate.length <= maxBodyChars) {
      buf = candidate;
      continue;
    }
    flush();
    buf = unit;
  }
  flush();

  if (bodies.length >= 2 && bodies.at(-1).length < minChars) {
    const last = bodies.pop();
    const prev = bodies.pop();
    if ((prev + '\n\n' + last).length <= maxBodyChars) {
      bodies.push(prev + '\n\n' + last);
    } else {
      bodies.push(prev, last);
    }
  }

  return bodies;
}

function withOverlap(bodies) {
  const overlap = RAG_CONFIG.chunking.overlapChars;
  if (!overlap || bodies.length < 2) return bodies.slice();

  return bodies.map((body, index) => {
    if (index === 0) return body;
    const previous = bodies[index - 1];
    const prefix = previous.slice(Math.max(0, previous.length - overlap)).trim();
    const combined = prefix ? `${prefix}\n\n${body}` : body;
    return combined.slice(0, RAG_CONFIG.chunking.maxChars);
  });
}

function normalizeSections(payload) {
  const input = Array.isArray(payload?.sections) && payload.sections.length
    ? payload.sections
    : [{ text: payload?.text || '', headingPath: payload?.headingPath || '' }];

  return input.slice(0, 1000).map((section, index) => ({
    sectionNo: index + 1,
    pageFrom: Number.isFinite(Number(section?.pageFrom)) ? Number(section.pageFrom) : null,
    pageTo: Number.isFinite(Number(section?.pageTo)) ? Number(section.pageTo) : null,
    sheetName: cleanText(section?.sheetName, 200),
    slideNo: Number.isFinite(Number(section?.slideNo)) ? Number(section.slideNo) : null,
    headingPath: cleanText(section?.headingPath || section?.heading, 500),
    text: cleanText(section?.text, 500000)
  })).filter(s => s.text);
}

function chunkDocument(payload) {
  const sections = normalizeSections(payload);
  const chunks = [];

  for (const section of sections) {
    const bodies = withOverlap(makeBodies(section.text));
    for (const body of bodies) {
      chunks.push({
        chunkNo: chunks.length + 1,
        pageFrom: section.pageFrom,
        pageTo: section.pageTo,
        sheetName: section.sheetName || '',
        slideNo: section.slideNo,
        headingPath: section.headingPath || '',
        text: body,
        charCount: body.length
      });
    }
  }

  return {
    sections,
    chunks,
    extractedCharCount: sections.reduce((sum, s) => sum + s.text.length, 0)
  };
}

export { cleanText, normalizeSections, chunkDocument };
