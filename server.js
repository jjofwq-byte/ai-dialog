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
    return res.status(401).json({ error: '인증 실패: 잘못된 토큰입니다.' });
  }
  next();
});

// -------------------------------------------------------------
// Gemini API 호출 함수 (1인 2역을 위한 공통 함수)
// -------------------------------------------------------------
async function callGemini(apiKey, history, systemPrompt) {
  // v1beta API는 system_instruction 필드를 완벽하게 지원하므로,
  // 텍스트를 우회해서 조작할 필요 없이 순수한 대화 내역만 매핑합니다.
  const contents = history.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  // 방금 확인하신 최신 모델 'gemini-3.1-pro-preview'와 'v1beta' 엔드포인트를 사용합니다.
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // v1beta에서 공식 지원하는 시스템 프롬프트 필드
        system_instruction: {
          parts: [{ text: systemPrompt }]
        },
        contents
      })
    }
  );
  
  const data = await res.json();
  
  if (!res.ok) {
    console.error("Gemini API Error Detail:", JSON.stringify(data, null, 2)); // 에러를 더 자세히 로깅
    throw new Error(data?.error?.message || `HTTP ${res.status}`);
  }
  
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini 응답이 비어있습니다: ' + JSON.stringify(data).slice(0, 200));
  }
  
  return text;
}

// -------------------------------------------------------------
// 메인 대화/토론 생성 라우터
// -------------------------------------------------------------
app.post('/dialog', async (req, res) => {
  try {
    const { topic, rounds = 3, mode = 'debate' } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new Error("GEMINI_API_KEY 환경변수가 설정되지 않았습니다.");
    }

    const modes = {
      debate: {
        aSystem: '당신은 토론자 A입니다. 주제에 대해 찬성 입장을 취하고 상대방의 주장을 날카롭게 논리적으로 반박하세요. 답변은 간결하고 명확하게 해주세요.',
        bSystem: '당신은 토론자 B입니다. 주제에 대해 반대 입장을 취하고 A의 주장을 날카롭게 논리적으로 반박하세요. 답변은 간결하고 명확하게 해주세요.'
      },
      build: {
        aSystem: '당신은 아이디어 제안자 A입니다. 주제에 대해 창의적인 아이디어를 먼저 제시하세요.',
        bSystem: '당신은 아이디어 발전자 B입니다. 상대방의 아이디어를 칭찬하고, 그 아이디어를 더욱 구체화하고 발전시킬 방법을 덧붙이세요.'
      }
    };

    const m = modes[mode] || modes.debate;
    
    // 역할별 대화 기록을 따로 저장하여 각자의 페르소나를 유지합니다.
    const histA = []; 
    const histB = []; 
    const dialog = []; 

    for (let r = 1; r <= rounds; r++) {
      // --- [Turn 1: 토론자 A 발언] ---
      const promptA = r === 1
        ? `주제: "${topic}"\n\n먼저 입장을 제시하며 토론을 시작해주세요.`
        : `상대방: "${histB.at(-1)?.content}"\n\n위 상대방의 주장에 응답하고 반박해주세요.`;

      histA.push({ role: 'user', content: promptA });
      const replyA = await callGemini(apiKey, histA, m.aSystem);
      histA.push({ role: 'assistant', content: replyA });
      dialog.push({ role: 'A', text: replyA, round: r });

      // --- [Turn 2: 토론자 B 발언] ---
      const promptB = `상대방: "${replyA}"\n\n위 상대방의 주장에 응답하고 반박해주세요.`;
      
      histB.push({ role: 'user', content: promptB });
      const replyB = await callGemini(apiKey, histB, m.bSystem);
      histB.push({ role: 'assistant', content: replyB });
      dialog.push({ role: 'B', text: replyB, round: r });
    }

    // 최종 토론 내역을 클라이언트로 전송
    res.json({ dialog });
  } catch (err) {
    console.error("Dialog API Error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (_, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`서버 실행 중 :${PORT}`));
