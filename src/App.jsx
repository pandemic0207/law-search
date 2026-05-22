import { useState, useRef, useEffect } from "react";
import LAWS_DATA from "./data/laws.json";

// ─────────────────────────────────────────
// 운영환경 설정 (API 키 발급 후 AI 기능 활성화 시 수정)
// ─────────────────────────────────────────
const CONFIG = {
  AI_ENDPOINT:       "/api/ai",               // Vercel 서버리스 프록시
  AI_MODEL:          "claude-sonnet-4-20250514",
  STORAGE_KEY_LAWS:  "sls_laws_v2",
  STORAGE_KEY_FILES: "sls_loaded_files_v2",
  AI_ENABLED:        false,                   // true로 바꾸면 AI 기능 활성화
};

// ─────────────────────────────────────────
// 법령 파일 목록
// ─────────────────────────────────────────
const LAW_FILES = [
  { category:"산업안전보건법",                       short:"산안법" },
  { category:"산업안전보건법 시행령",                 short:"산안법 시행령" },
  { category:"산업안전보건법 시행규칙",               short:"산안법 시행규칙" },
  { category:"산업안전보건 기준에 관한 규칙",         short:"안전보건규칙" },
  { category:"유해·위험작업의 취업제한에 관한 규칙",  short:"취업제한규칙" },
  { category:"중대재해처벌법",                       short:"중대재해법" },
  { category:"중대재해처벌법 시행령",                 short:"중대재해 시행령" },
];

const SAFETY_CATS = LAW_FILES.map(f => f.category);
const ALL_CATS    = ["전체", ...SAFETY_CATS, "노동법", "세법", "계약법", "환경법", "개인정보보호법", "공정거래법"];
const CAT_COLOR   = {
  "노동법":"#3b82f6","세법":"#f59e0b","계약법":"#8b5cf6","환경법":"#10b981",
  "산업안전보건법":"#ef4444","산업안전보건법 시행령":"#f97316",
  "산업안전보건법 시행규칙":"#fb923c","산업안전보건 기준에 관한 규칙":"#dc2626",
  "유해·위험작업의 취업제한에 관한 규칙":"#b91c1c",
  "중대재해처벌법":"#7c3aed","중대재해처벌법 시행령":"#6d28d9",
  "개인정보보호법":"#0891b2","공정거래법":"#d97706",
};

// ─────────────────────────────────────────
// localStorage 유틸
// ─────────────────────────────────────────
function storageSave(laws, loadedFiles) {
  try {
    localStorage.setItem(CONFIG.STORAGE_KEY_LAWS,  JSON.stringify(laws));
    localStorage.setItem(CONFIG.STORAGE_KEY_FILES, JSON.stringify(loadedFiles));
  } catch(e) { console.warn("Storage save failed:", e); }
}
function storageLoad() {
  try {
    const l = localStorage.getItem(CONFIG.STORAGE_KEY_LAWS);
    const f = localStorage.getItem(CONFIG.STORAGE_KEY_FILES);
    return { laws: l ? JSON.parse(l) : null, loadedFiles: f ? JSON.parse(f) : null };
  } catch(e) { return { laws: null, loadedFiles: null }; }
}
function storageClear() {
  localStorage.removeItem(CONFIG.STORAGE_KEY_LAWS);
  localStorage.removeItem(CONFIG.STORAGE_KEY_FILES);
}

// ─────────────────────────────────────────
// AI API 호출 (AI_ENABLED=true 일 때만 사용)
// ─────────────────────────────────────────
async function callAI(messages, useWebSearch = false) {
  const body = { model: CONFIG.AI_MODEL, max_tokens: 1000, messages };
  if (useWebSearch) body.tools = [{ type: "web_search_20250305", name: "web_search" }];
  const res  = await fetch(CONFIG.AI_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  return data.content.map(b => b.type === "text" ? b.text : "").filter(Boolean).join("\n");
}

// ─────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────
export default function App() {
  const [laws,        setLaws]        = useState([]);
  const [loadedFiles, setLoadedFiles] = useState({});
  const [storageInit, setStorageInit] = useState(true);

  const [query,    setQuery]    = useState("");
  const [category, setCategory] = useState("전체");
  const [results,  setResults]  = useState([]);
  const [selected, setSelected] = useState(null);
  const [searched, setSearched] = useState(false);

  const [aiPanel, setAiPanel] = useState({ mode: null, content: "", loading: false });
  const [qaInput, setQaInput] = useState("");

  const [compareList,    setCompareList]    = useState([]);
  const [compareMode,    setCompareMode]    = useState(false);
  const [compareResult,  setCompareResult]  = useState("");
  const [compareLoading, setCompareLoading] = useState(false);

  const [showCatMenu, setShowCatMenu] = useState(false);
  const [toast,       setToast]       = useState("");

  const nextId = useRef(200);
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 4000); };

  // ── 앱 시작 시 데이터 복원 ──
  useEffect(() => {
    const { laws: stored, loadedFiles: storedFiles } = storageLoad();
    const initialLaws = (stored && stored.length > LAWS_DATA.length) ? stored : LAWS_DATA;
    setLaws(initialLaws);
    const maxId = Math.max(...initialLaws.map(l => l.id), 199);
    nextId.current = maxId + 1;

    const autoLoaded = {};
    LAW_FILES.forEach(f => {
      const cnt = initialLaws.filter(l => l.category === f.category).length;
      if (cnt > 0) autoLoaded[f.category] = cnt;
    });
    setLoadedFiles(storedFiles || autoLoaded);
    setStorageInit(false);
  }, []);

  const goHome = () => {
    setSearched(false); setResults([]); setSelected(null);
    setQuery(""); setCategory("전체");
    setAiPanel({ mode: null, content: "", loading: false });
    setCompareMode(false); setCompareList([]); setCompareResult("");
  };

  const handleSearch = () => {
    if (!query.trim()) return;
    const q = query.toLowerCase();
    const filtered = laws.filter(l =>
      (category === "전체" || l.category === category) &&
      (l.title.toLowerCase().includes(q) || l.subtitle.toLowerCase().includes(q) ||
       l.summary.toLowerCase().includes(q) || l.category.toLowerCase().includes(q))
    );
    setResults(filtered); setSelected(null);
    setAiPanel({ mode: null, content: "", loading: false });
    setSearched(true); setCompareMode(false); setCompareResult("");
  };

  const handleAI = async (mode) => {
    if (!selected || !CONFIG.AI_ENABLED) return;
    setAiPanel({ mode, content: "", loading: true });
    const prompt = mode === "interpret"
      ? `다음 법령 조항을 안전보건 업무 담당자가 쉽게 이해할 수 있도록 설명해 주세요.\n\n법령: ${selected.title} (${selected.subtitle})\n내용: ${selected.summary}`
      : `${selected.title} (${selected.subtitle})의 최근 개정 사항, 행정해석, 판례 등을 검색하여 알려주세요.`;
    const text = await callAI([{ role: "user", content: prompt }], mode === "recent");
    setAiPanel({ mode, content: text, loading: false });
  };

  const handleQA = async () => {
    if (!qaInput.trim() || !CONFIG.AI_ENABLED) return;
    setAiPanel({ mode: "qa", content: "", loading: true });
    const ctx  = selected ? `참고 법령: ${selected.title}\n${selected.summary}\n\n` : "";
    const text = await callAI([{ role: "user", content: `${ctx}질문: ${qaInput}` }], true);
    setAiPanel({ mode: "qa", content: text, loading: false });
    setQaInput("");
  };

  const toggleCompare = (law) => {
    setCompareList(prev => {
      if (prev.find(l => l.id === law.id)) return prev.filter(l => l.id !== law.id);
      if (prev.length >= 2) return [...prev.slice(1), law];
      return [...prev, law];
    });
    setCompareResult("");
  };

  const handleCompare = async () => {
    if (compareList.length < 2 || !CONFIG.AI_ENABLED) return;
    setCompareLoading(true); setCompareResult("");
    const [a, b] = compareList;
    const text   = await callAI([{ role: "user", content: `두 법령을 비교 분석해 주세요.\n\n【A】${a.title}\n${a.summary}\n\n【B】${b.title}\n${b.summary}` }]);
    setCompareResult(text); setCompareLoading(false);
  };

  const exportCSV = () => {
    if (!results.length) return;
    const hdr  = ["법령명", "조항 제목", "법령 분야", "조항 내용", "관련 법령"];
    const rows = results.map(l => [l.title, l.subtitle, l.category, l.summary, (l.related || []).join(" / ")]);
    const csv  = [hdr, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a"); a.href = url; a.download = `법령검색결과_${query}.csv`; a.click(); URL.revokeObjectURL(url);
    showToast("📊 엑셀 파일 다운로드 완료");
  };

  const exportPDF = () => {
    if (!results.length) return;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>법령 검색결과</title>
<style>body{font-family:'Apple SD Gothic Neo',sans-serif;padding:28px;color:#1e293b}h1{font-size:17px;color:#1e3a5f;border-bottom:2px solid #1e3a5f;padding-bottom:8px}.card{border:1px solid #e2e8f0;border-radius:6px;padding:12px;margin-bottom:10px;break-inside:avoid}.cat{display:inline-block;font-size:11px;padding:2px 8px;border-radius:20px;background:#e8f0fe;color:#2d6a9f;margin-bottom:4px}.body{font-size:12px;color:#475569;line-height:1.7}.footer{font-size:11px;color:#94a3b8;margin-top:20px;border-top:1px solid #e2e8f0;padding-top:8px}</style>
</head><body>
<h1>⚖️ 스마트 법규 검색 결과</h1>
<p style="font-size:12px;color:#64748b">검색어: <b>${query}</b> · ${results.length}건 · ${new Date().toLocaleDateString("ko-KR")}</p>
${results.map((l,i) => `<div class="card"><span class="cat">${l.category}</span><p style="margin:4px 0;font-size:13px;font-weight:700">${i+1}. ${l.title} 【${l.subtitle}】</p><p class="body">${l.summary}</p></div>`).join("")}
<div class="footer">본 문서는 스마트 법규 검색 도구에서 생성되었습니다. 공식 법령 원문을 반드시 확인하세요.</div>
</body></html>`;
    const w = window.open("", "_blank"); w.document.write(html); w.document.close(); setTimeout(() => w.print(), 400);
  };

  const otherCats   = ALL_CATS.filter(c => !SAFETY_CATS.includes(c) && c !== "전체");
  const totalLoaded = Object.values(loadedFiles).reduce((a, b) => a + b, 0);

  return (
    <div style={{ fontFamily: "'Apple SD Gothic Neo','Malgun Gothic',sans-serif", background: "#f0f4f8", minHeight: "100vh", display: "flex", flexDirection: "column" }}>

      {toast && <div style={{ position:"fixed", top:16, left:"50%", transform:"translateX(-50%)", background:"#1e3a5f", color:"#fff", padding:"10px 20px", borderRadius:20, fontSize:13, fontWeight:600, zIndex:999, boxShadow:"0 4px 16px #0003", whiteSpace:"nowrap" }}>{toast}</div>}

      {storageInit && (
        <div style={{ position:"fixed", inset:0, background:"#1e3a5fee", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center" }}>
          <div style={{ textAlign:"center", color:"#fff" }}>
            <div style={{ fontSize:36, marginBottom:12 }}>⚖️</div>
            <p style={{ fontSize:15, fontWeight:700 }}>법령 데이터 불러오는 중...</p>
          </div>
        </div>
      )}

      {/* ── 헤더 ── */}
      <div style={{ background:"linear-gradient(135deg,#1e3a5f 0%,#2d6a9f 100%)", padding:"14px 18px 12px", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8, flexWrap:"wrap" }}>
          <span style={{ fontSize:18 }}>⚖️</span>
          <span style={{ color:"#fff", fontSize:16, fontWeight:700 }}>스마트 법규 검색</span>
          <span style={{ background:"#ffffff22", color:"#cde", fontSize:10, padding:"2px 8px", borderRadius:20 }}>팀 업무용</span>
          {!CONFIG.AI_ENABLED && <span style={{ background:"#f59e0b33", color:"#fcd34d", fontSize:10, padding:"2px 8px", borderRadius:20 }}>AI 기능 준비 중</span>}
          <div style={{ marginLeft:"auto", display:"flex", gap:6, alignItems:"center" }}>
            <span style={{ color:"#a8c8e8", fontSize:11 }}>{laws.length}개 조항</span>
            {searched && <button onClick={goHome} style={{ background:"#ffffff33", color:"#fff", border:"none", borderRadius:7, padding:"5px 11px", fontSize:11, fontWeight:700, cursor:"pointer" }}>🏠 처음으로</button>}
            {compareList.length > 0 && <button onClick={() => setCompareMode(true)} style={{ background:compareList.length===2?"#f0a500":"#ffffff33", color:"#fff", border:"none", borderRadius:7, padding:"5px 11px", fontSize:11, fontWeight:700, cursor:"pointer" }}>🔀 비교 {compareList.length}/2{compareList.length===2?" →":""}</button>}
          </div>
        </div>

        {/* 법령 상태 바 */}
        <div style={{ display:"flex", gap:5, marginBottom:10, flexWrap:"wrap" }}>
          {LAW_FILES.map(f => {
            const cnt = loadedFiles[f.category];
            return (
              <div key={f.category} style={{ display:"flex", alignItems:"center", gap:4, padding:"4px 10px", borderRadius:8, background: cnt ? "#ffffff22" : "#ef444433", color:"#fff", fontSize:11, fontWeight:700 }}>
                <span>{cnt ? "✅" : "⏳"}</span>
                <span>{f.short}</span>
                {cnt && <span style={{ background:"#ffffff33", borderRadius:20, padding:"1px 6px", fontSize:10 }}>{cnt}개</span>}
              </div>
            );
          })}
          {totalLoaded > 0 && <span style={{ color:"#86efac", fontSize:11, alignSelf:"center", marginLeft:4 }}>💾 {totalLoaded}개 로드됨</span>}
        </div>

        {/* 검색창 */}
        <div style={{ display:"flex", gap:8 }}>
          <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSearch()}
            placeholder="키워드 검색 (예: 안전관리자, 보호구, 도급, 교육시간, 중대재해)"
            style={{ flex:1, padding:"9px 13px", borderRadius:8, border:"none", fontSize:13, outline:"none" }}/>
          <button onClick={handleSearch} style={{ background:"#f0a500", color:"#fff", border:"none", borderRadius:8, padding:"9px 16px", fontWeight:700, fontSize:13, cursor:"pointer" }}>검색</button>
        </div>

        {/* 분야 필터 */}
        <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginTop:10, alignItems:"center" }}>
          <button onClick={() => setCategory("전체")} style={{ padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:600, cursor:"pointer", background:category==="전체"?"#f0a500":"#ffffff22", color:"#fff", border:"none" }}>전체</button>
          {SAFETY_CATS.map(c => (
            <button key={c} onClick={() => setCategory(c)} style={{ padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:600, cursor:"pointer", background:category===c?(CAT_COLOR[c]||"#f0a500"):"#ffffff22", color:"#fff", border:"none" }}>{c}</button>
          ))}
          <div style={{ position:"relative" }}>
            <button onClick={() => setShowCatMenu(p => !p)} style={{ padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:600, cursor:"pointer", background:otherCats.includes(category)?"#f0a500":"#ffffff22", color:"#fff", border:"none" }}>기타 법령 ▾</button>
            {showCatMenu && (
              <div style={{ position:"absolute", top:26, left:0, background:"#fff", borderRadius:8, boxShadow:"0 4px 16px #0003", zIndex:99, minWidth:140, padding:"4px 0" }}>
                {otherCats.map(c => (<button key={c} onClick={() => { setCategory(c); setShowCatMenu(false); }} style={{ display:"block", width:"100%", textAlign:"left", padding:"6px 14px", fontSize:12, fontWeight:600, border:"none", background:category===c?"#f0f4f8":"#fff", cursor:"pointer", color:CAT_COLOR[c]||"#334155" }}>{c}</button>))}
              </div>
            )}
          </div>
        </div>
        {category !== "전체" && <p style={{ color:"#a8c8e8", fontSize:11, margin:"5px 0 0" }}>선택된 분야: <b style={{ color:"#fff" }}>{category}</b></p>}
      </div>

      {/* ── 바디 ── */}
      <div style={{ display:"flex", flex:1, overflow:"hidden" }}>

        {/* 검색결과 리스트 */}
        <div style={{ width:(selected||compareMode)?"38%":"100%", overflowY:"auto", padding:"12px 10px", transition:"width 0.3s", flexShrink:0 }}>
          {!searched ? (
            <div style={{ textAlign:"center", color:"#94a3b8", padding:"32px 16px" }}>
              <div style={{ fontSize:34 }}>🔍</div>
              <p style={{ fontSize:13, fontWeight:600, marginTop:10 }}>법령 키워드를 검색해 보세요</p>
              <p style={{ fontSize:12 }}>총 <b style={{ color:"#2d6a9f" }}>{laws.length}개</b> 조항이 등록되어 있습니다</p>
              {totalLoaded > 0 && (
                <div style={{ marginTop:12, background:"#f0fdf4", borderRadius:10, padding:"12px", border:"1px solid #86efac" }}>
                  <p style={{ fontSize:13, fontWeight:700, color:"#166534", margin:0 }}>✅ 모든 법령이 로드되어 있습니다</p>
                  <p style={{ fontSize:12, color:"#15803d", margin:"4px 0 0" }}>{totalLoaded}개 조항 — 바로 검색하세요</p>
                </div>
              )}
            </div>
          ) : results.length === 0 ? (
            <div style={{ textAlign:"center", color:"#94a3b8", padding:"40px 16px" }}>
              <div style={{ fontSize:32 }}>📭</div>
              <p style={{ fontSize:13, fontWeight:600 }}>검색 결과가 없습니다</p>
              <p style={{ fontSize:12 }}>다른 키워드로 다시 시도해 보세요</p>
              <button onClick={goHome} style={{ marginTop:12, padding:"8px 20px", background:"#2d6a9f", color:"#fff", border:"none", borderRadius:8, fontSize:12, fontWeight:700, cursor:"pointer" }}>🏠 처음으로</button>
            </div>
          ) : (
            <>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <p style={{ fontSize:11, color:"#64748b", margin:0 }}>검색결과 <b>{results.length}</b>건</p>
                  <button onClick={goHome} style={{ fontSize:11, color:"#2d6a9f", background:"none", border:"none", cursor:"pointer", fontWeight:600, padding:0 }}>← 처음으로</button>
                </div>
                <div style={{ display:"flex", gap:5 }}>
                  <button onClick={exportCSV} style={{ padding:"4px 10px", background:"#059669", color:"#fff", border:"none", borderRadius:6, fontSize:11, fontWeight:700, cursor:"pointer" }}>📊 엑셀</button>
                  <button onClick={exportPDF} style={{ padding:"4px 10px", background:"#ef4444", color:"#fff", border:"none", borderRadius:6, fontSize:11, fontWeight:700, cursor:"pointer" }}>🖨️ PDF</button>
                </div>
              </div>
              {results.map(law => {
                const inCmp = compareList.find(l => l.id === law.id);
                return (
                  <div key={law.id} onClick={() => { setSelected(law); setAiPanel({ mode:null, content:"", loading:false }); setCompareMode(false); }}
                    style={{ background:selected?.id===law.id?"#e8f0fe":"#fff", border:`2px solid ${selected?.id===law.id?"#2d6a9f":"transparent"}`, borderRadius:10, padding:"10px 12px", marginBottom:7, cursor:"pointer", boxShadow:"0 1px 3px #0001" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:6 }}>
                      <div style={{ flex:1 }}>
                        <p style={{ margin:0, fontSize:12, fontWeight:700, color:"#1e3a5f" }}>{law.title}</p>
                        <p style={{ margin:"1px 0", fontSize:11, color:"#64748b" }}>【{law.subtitle}】</p>
                      </div>
                      <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:3 }}>
                        <span style={{ fontSize:10, padding:"2px 7px", borderRadius:20, fontWeight:600, background:(CAT_COLOR[law.category]||"#64748b")+"22", color:CAT_COLOR[law.category]||"#64748b", whiteSpace:"nowrap", maxWidth:110, overflow:"hidden", textOverflow:"ellipsis" }}>{law.category}</span>
                        <button onClick={e => { e.stopPropagation(); toggleCompare(law); }} style={{ fontSize:10, padding:"2px 7px", borderRadius:20, fontWeight:600, cursor:"pointer", border:"none", background:inCmp?"#fbbf24":"#e2e8f0", color:inCmp?"#fff":"#475569", whiteSpace:"nowrap" }}>{inCmp ? "✓ 비교선택" : "+ 비교"}</button>
                      </div>
                    </div>
                    <p style={{ fontSize:11, color:"#64748b", margin:"5px 0 0", lineHeight:1.6, overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>{law.summary}</p>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* 비교 패널 */}
        {compareMode && compareList.length === 2 && (
          <div style={{ flex:1, background:"#fff", borderLeft:"1px solid #e2e8f0", overflowY:"auto", display:"flex", flexDirection:"column" }}>
            <div style={{ background:"#1e3a5f", padding:"12px 14px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ color:"#fff", fontWeight:700, fontSize:14 }}>🔀 법령 비교</span>
              <button onClick={() => setCompareMode(false)} style={{ background:"none", border:"none", color:"#aaa", fontSize:18, cursor:"pointer" }}>✕</button>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", borderBottom:"1px solid #e2e8f0" }}>
              {compareList.map((law, i) => (
                <div key={law.id} style={{ padding:"12px 14px", background:i===0?"#eff6ff":"#fef9ec", borderRight:i===0?"1px solid #e2e8f0":"none" }}>
                  <p style={{ margin:0, fontSize:11, fontWeight:700, color:i===0?"#2d6a9f":"#b45309" }}>법령 {i===0?"A":"B"}</p>
                  <p style={{ margin:"3px 0 0", fontSize:12, fontWeight:700 }}>{law.title}</p>
                  <p style={{ margin:"2px 0 0", fontSize:11, color:"#64748b" }}>【{law.subtitle}】</p>
                  <p style={{ margin:"6px 0 0", fontSize:11, color:"#475569", lineHeight:1.6 }}>{law.summary}</p>
                </div>
              ))}
            </div>
            <div style={{ padding:"14px 16px" }}>
              {CONFIG.AI_ENABLED
                ? (!compareResult && !compareLoading
                    ? <button onClick={handleCompare} style={{ width:"100%", padding:"10px 0", background:"linear-gradient(135deg,#1e3a5f,#2d6a9f)", color:"#fff", border:"none", borderRadius:8, fontSize:13, fontWeight:700, cursor:"pointer" }}>🤖 AI 비교 분석 시작</button>
                    : compareLoading
                      ? <div style={{ textAlign:"center", padding:"24px 0", color:"#64748b" }}><p>분석 중...</p></div>
                      : <div><p style={{ fontSize:11, color:"#94a3b8", marginBottom:8 }}>🤖 비교 분석 결과</p><div style={{ fontSize:13, color:"#334155", lineHeight:1.85, whiteSpace:"pre-wrap", background:"#f8fafc", padding:"12px", borderRadius:8, border:"1px solid #e2e8f0" }}>{compareResult}</div></div>)
                : <div style={{ textAlign:"center", padding:"20px", background:"#f8fafc", borderRadius:8 }}>
                    <p style={{ fontSize:13, color:"#94a3b8", margin:0 }}>🤖 AI 비교 분석 기능은 API 연결 후 활성화됩니다</p>
                  </div>
              }
            </div>
          </div>
        )}

        {/* AI 상세 패널 */}
        {selected && !compareMode && (
          <div style={{ flex:1, background:"#fff", borderLeft:"1px solid #e2e8f0", overflowY:"auto", display:"flex", flexDirection:"column" }}>
            <div style={{ background:"#f8fafc", borderBottom:"1px solid #e2e8f0", padding:"12px 14px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                <div>
                  <p style={{ margin:0, fontSize:13, fontWeight:700, color:"#1e3a5f" }}>{selected.title}</p>
                  <p style={{ margin:"2px 0 0", fontSize:11, color:"#64748b" }}>【{selected.subtitle}】 · <span style={{ color:CAT_COLOR[selected.category]||"#64748b", fontWeight:600 }}>{selected.category}</span></p>
                </div>
                <button onClick={() => setSelected(null)} style={{ background:"none", border:"none", fontSize:18, cursor:"pointer", color:"#94a3b8" }}>✕</button>
              </div>
              <p style={{ margin:"8px 0 0", fontSize:12, color:"#475569", lineHeight:1.7, background:"#fff", padding:"8px 10px", borderRadius:6, border:"1px solid #e2e8f0" }}>{selected.summary}</p>
              <div style={{ marginTop:8 }}>
                <p style={{ fontSize:11, color:"#94a3b8", margin:"0 0 4px" }}>관련 법령</p>
                <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>{(selected.related||[]).map((r,i) => <span key={i} style={{ fontSize:11, background:"#e8f0fe", color:"#2d6a9f", padding:"3px 8px", borderRadius:20 }}>🔗 {r}</span>)}</div>
              </div>
              <div style={{ display:"flex", gap:6, marginTop:10 }}>
                <button onClick={() => handleAI("interpret")} disabled={!CONFIG.AI_ENABLED}
                  style={{ flex:1, padding:"8px 0", background:CONFIG.AI_ENABLED?"#2d6a9f":"#cbd5e1", color:CONFIG.AI_ENABLED?"#fff":"#94a3b8", border:"none", borderRadius:7, fontSize:12, fontWeight:600, cursor:CONFIG.AI_ENABLED?"pointer":"not-allowed" }}>
                  🤖 AI 해석{!CONFIG.AI_ENABLED?" (준비 중)":""}
                </button>
                <button onClick={() => handleAI("recent")} disabled={!CONFIG.AI_ENABLED}
                  style={{ flex:1, padding:"8px 0", background:CONFIG.AI_ENABLED?"#059669":"#cbd5e1", color:CONFIG.AI_ENABLED?"#fff":"#94a3b8", border:"none", borderRadius:7, fontSize:12, fontWeight:600, cursor:CONFIG.AI_ENABLED?"pointer":"not-allowed" }}>
                  🔎 판례{!CONFIG.AI_ENABLED?" (준비 중)":""}
                </button>
              </div>
            </div>
            <div style={{ flex:1, padding:"12px 14px", overflowY:"auto" }}>
              {aiPanel.loading
                ? <div style={{ textAlign:"center", padding:"28px 0", color:"#64748b" }}><p>AI 분석 중...</p></div>
                : aiPanel.content
                  ? <div><p style={{ fontSize:11, color:"#94a3b8", margin:"0 0 8px", fontWeight:600 }}>{aiPanel.mode==="interpret"?"🤖 AI 해석 결과":"🔎 최신 개정·판례"}</p><div style={{ fontSize:13, color:"#334155", lineHeight:1.8, whiteSpace:"pre-wrap", background:"#f8fafc", padding:"12px 14px", borderRadius:8, border:"1px solid #e2e8f0" }}>{aiPanel.content}</div></div>
                  : <div style={{ textAlign:"center", color:"#94a3b8", padding:"28px 0" }}><div style={{ fontSize:26 }}>📋</div><p style={{ fontSize:12, marginTop:8 }}>조항 내용을 확인하세요</p></div>}
            </div>
            <div style={{ borderTop:"1px solid #e2e8f0", padding:"10px 12px", background:"#f8fafc" }}>
              <p style={{ fontSize:11, color:"#64748b", margin:"0 0 5px", fontWeight:600 }}>
                💬 실무 Q&A {!CONFIG.AI_ENABLED && <span style={{ background:"#f1f5f9", padding:"2px 8px", borderRadius:20, color:"#94a3b8", fontSize:10 }}>API 연결 후 활성화</span>}
              </p>
              <div style={{ display:"flex", gap:6 }}>
                <input value={qaInput} onChange={e => setQaInput(e.target.value)} onKeyDown={e => e.key==="Enter" && handleQA()}
                  disabled={!CONFIG.AI_ENABLED}
                  placeholder={CONFIG.AI_ENABLED ? "예: 이 조항을 위반하면 처벌은?" : "API 키 설정 후 이용 가능합니다"}
                  style={{ flex:1, padding:"8px 11px", borderRadius:7, border:"1px solid #cbd5e1", fontSize:12, outline:"none", background:CONFIG.AI_ENABLED?"#fff":"#f8fafc", color:CONFIG.AI_ENABLED?"#1e293b":"#94a3b8" }}/>
                <button onClick={handleQA} disabled={!CONFIG.AI_ENABLED}
                  style={{ background:CONFIG.AI_ENABLED?"#f0a500":"#cbd5e1", color:CONFIG.AI_ENABLED?"#fff":"#94a3b8", border:"none", borderRadius:7, padding:"8px 13px", fontSize:12, fontWeight:700, cursor:CONFIG.AI_ENABLED?"pointer":"not-allowed" }}>질문</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}