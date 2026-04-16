const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

// 비밀 토큰 확인 — 토큰 없으면 차단
app.use((req, res, next) => {
  if (req.path === '/health') return next(); // 헬스체크는 통과
  const token = req.headers['x-access-token'];
  if (token !== process.env.ACCESS_TOKEN) {
    return res.status(401).json({ error: '인증 실패' });
  }
  next();
});

async function callGemini(apiKey, history, systemPrompt) {
  const res = await fetch(
`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: history.map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        }))
      })
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
  return data.candidates[0].content.parts[0].text;
}

app.post('/dialog', async (req, res) => {
    try {
  const { topic, rounds = 3, mode = 'debate' } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  const modes = {
    debate: {
      aSystem: '당신은 토론자 A입니다. 찬성 입장을 취하고 상대 주장을 논리적으로 반박하세요. 한국어로 3-5문장.',
      bSystem: '당신은 토론자 B입니다. 반대 입장을 취하고 A의 주장을 반박하세요. 한국어로 3-5문장.'
    },
    build: {
      aSystem: '당신은 아이디어 제안자입니다. 창의적인 아이디어를 제시하세요. 한국어로 3-5문장.',
      bSystem: '당신은 아이디어 발전자입니다. 상대 아이디어를 구체화하고 발전시키세요. 한국어로 3-5문장.'
    }
  };

  const m = modes[mode] || modes.debate;
  const histA = [], histB = [];
  const dialog = [];

  for (let r = 1; r <= rounds; r++) {
    const promptA = r === 1
      ? `주제: "${topic}"\n\n입장을 제시해주세요.`
      : `상대방: "${histB.at(-1)?.content}"\n\n응답해주세요.`;

    histA.push({ role: 'user', content: promptA });
    const replyA = await callGemini(apiKey, histA, m.aSystem);
    histA.push({ role: 'assistant', content: replyA });
    dialog.push({ role: 'A', text: replyA, round: r });

    const promptB = `상대방: "${replyA}"\n\n응답해주세요.`;
    histB.push({ role: 'user', content: promptB });
    const replyB = await callGemini(apiKey, histB, m.bSystem);
    histB.push({ role: 'assistant', content: replyB });
    dialog.push({ role: 'B', text: replyB, round: r });
  }

  res.json({ dialog });
} catch (err) {
      res.status(500).json({ error: err.message });
        }
});

app.get('/health', (_, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`서버 실행 중 :${PORT}`));
