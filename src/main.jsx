import React, { useState, useMemo } from 'react';

const GEMINI_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite'
];

const MODERNISATION_TRACKS = {
  schema: {
    id: 'schema',
    name: '1. IMS DB to PostgreSQL (Schema)',
    sourceLabel: 'Legacy IMS DBD',
    targetLabel: 'PostgreSQL DDL',
    placeholder: 'Paste IMS Database Description (DBD) here...',
    rules: 'Convert the hierarchical IMS DBD segments into relational PostgreSQL DDL. Create appropriate primary and foreign keys to flatten the hierarchy.'
  },
  logic: {
    id: 'logic',
    name: '2. COBOL to Java Spring (Logic)',
    sourceLabel: 'Legacy COBOL / DL/I',
    targetLabel: 'Java Spring Boot',
    placeholder: 'Paste COBOL program with EXEC DLI calls here...',
    rules: 'Convert the COBOL business logic into a modern Java 17 Spring Boot REST Controller and Service. Replace IMS DL/I calls with Spring Data JPA repository methods.'
  },
  orchestration: {
    id: 'orchestration',
    name: '3. JCL to Apache Airflow (Orchestration)',
    sourceLabel: 'Legacy JCL Batch',
    targetLabel: 'Apache Airflow DAG (Python)',
    placeholder: 'Paste JCL step execution script here...',
    rules: 'Convert the JCL batch job into an Apache Airflow DAG in Python. Use standard Airflow operators (e.g., PythonOperator, BashOperator).'
  }
};

export default function App() {
  const [activeTab, setActiveTab] = useState('transpiler');
  const [activeTrackId, setActiveTrackId] = useState('logic');
  const [sourceCode, setSourceCode] = useState('');
  const [transpiledCode, setTranspiledCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [isError, setIsError] = useState(false);

  // Configuration
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [apiKey, setApiKey] = useState(() => {
    try { return localStorage.getItem('migrateops_gemini_key') || ''; } 
    catch { return ''; }
  });

  // Dual-Run Validation & Healing
  const [validationRun, setValidationRun] = useState(false);
  const [aiSelfHealing, setAiSelfHealing] = useState(false);
  const [isRemediating, setIsRemediating] = useState(false);
  const [isSelfHealedCode, setIsSelfHealedCode] = useState(false);

  const activeTrack = MODERNISATION_TRACKS[activeTrackId];

  const handleSaveConfig = () => {
    try { localStorage.setItem('migrateops_gemini_key', apiKey.trim()); } 
    catch {}
    setShowConfigModal(false);
    setIsError(false);
    setStatusMessage('Configuration saved.');
  };

  const handleTrackChange = (trackId) => {
    setActiveTrackId(trackId);
    setSourceCode('');
    setTranspiledCode('');
    setValidationRun(false);
    setAiSelfHealing(false);
    setIsSelfHealedCode(false);
    setStatusMessage(`Switched to ${MODERNISATION_TRACKS[trackId].name}.`);
  };

  // Mainframe-specific heuristics to simulate gatekeeping and drift
  const heuristics = useMemo(() => {
    const code = sourceCode.toUpperCase();
    
    // Flags
    const isEBCDIC = code.includes('DATASET') || code.includes('SEGM');
    const isComp3 = code.includes('COMP-3') || code.includes('PACKED-DECIMAL');
    const isHardcodedDSN = code.includes('DSN=') || code.includes('DISP=');
    
    let parityScore = '100.00%';
    let driftType = null;
    let healAction = null;
    let terminalDriftLog = '';
    let terminalHealLog = '';

    if (activeTrackId === 'logic' && isComp3) {
      parityScore = '72.14%';
      driftType = 'PACKED_DECIMAL_LOSS';
      healAction = 'Inject java.math.BigDecimal for COMP-3 precision safety';
      terminalDriftLog = '[warn] Financial precision loss detected. Standard Java Double cannot safely map COBOL COMP-3 packed decimals.';
      terminalHealLog = '[agent] Refactored data models to utilize java.math.BigDecimal for lossless financial processing.';
    } else if (activeTrackId === 'schema' && isEBCDIC) {
      parityScore = '0.00%';
      driftType = 'EBCDIC_ENCODING_CORRUPTION';
      healAction = 'Inject EBCDIC-to-UTF8 translation hooks';
      terminalDriftLog = '[critical] Character set mismatch. Legacy EBCDIC data will corrupt upon PostgreSQL ASCII/UTF-8 insertion.';
      terminalHealLog = '[agent] Generated EBCDIC conversion triggers/functions at the database layer.';
    } else if (activeTrackId === 'orchestration' && isHardcodedDSN) {
      parityScore = '45.00%';
      driftType = 'STATIC_STORAGE_BINDING';
      healAction = 'Replace static datasets with Cloud Object Storage (S3) hooks';
      terminalDriftLog = '[warn] DAG contains hardcoded mainframe dataset names (DSN=) incompatible with cloud execution.';
      terminalHealLog = '[agent] Rewrote file allocations to utilize dynamic Airflow S3Hooks and cloud-native URIs.';
    }

    return { parityScore, driftType, healAction, terminalDriftLog, terminalHealLog };
  }, [sourceCode, activeTrackId]);

  const callGeminiWithFallback = async (promptText) => {
    let lastError = null;
    for (const modelName of GEMINI_MODELS) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey.trim())}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] })
          }
        );
        clearTimeout(timeoutId);
        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          const msg = errData.error?.message || `HTTP ${response.status}`;
          if (response.status === 503 || response.status === 429 || /high demand|overloaded/i.test(msg)) {
            lastError = new Error(msg);
            continue;
          }
          throw new Error(msg);
        }
        const data = await response.json();
        const rawCode = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const cleanCode = rawCode.replace(/^```[a-z]*\n?|^```\n?|```$/gm, '').trim();
        if (!cleanCode) {
          lastError = new Error('Empty response returned.');
          continue;
        }
        return cleanCode;
      } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          lastError = new Error('Request timed out. Retrying fallback model...');
          continue;
        }
        lastError = err;
        break;
      }
    }
    throw lastError || new Error('All Gemini models failed to respond.');
  };

  const handleTranspile = async () => {
    if (!sourceCode.trim()) {
      setIsError(true);
      setStatusMessage('Please paste legacy mainframe code first.');
      return;
    }
    if (!apiKey.trim()) {
      setIsError(true);
      setStatusMessage('Please open ⚙️ Config and paste your Gemini API Key first.');
      return;
    }

    setIsLoading(true);
    setIsError(false);
    setTranspiledCode('');
    setValidationRun(false);
    setAiSelfHealing(false);
    setIsSelfHealedCode(false);

    const prompt = `You are an expert mainframe modernisation architect.
${activeTrack.rules}
Return ONLY the raw transpiled code with no markdown formatting, backticks, or explanations.

Legacy Source Code:
${sourceCode}`;

    try {
      const cleanCode = await callGeminiWithFallback(prompt);
      setTranspiledCode(cleanCode);
      setStatusMessage(`Transpilation complete. Legacy payload converted to ${activeTrack.targetLabel}.`);
    } catch (err) {
      setIsError(true);
      setStatusMessage(`Gemini API Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsLoading(false);
    }
  };

  const triggerSelfHealingRemediation = async () => {
    if (!transpiledCode.trim() || !heuristics.driftType) return;
    if (!apiKey.trim()) return;

    setIsRemediating(true);
    setIsError(false);

    const remediationPrompt = `You are a cloud-native remediation agent.
The following transpiled code failed architecture validation with drift type: ${heuristics.driftType}.
Required fix: ${heuristics.healAction}.

Apply the fix directly to the code below. Return ONLY the raw code with NO markdown backticks or explanations.

Code to remediate:
${transpiledCode}`;

    try {
      const rewrittenCode = await callGeminiWithFallback(remediationPrompt);
      const healBanner = `/* [AI SELF-HEALED | Fix: ${heuristics.healAction}] */`;
      const finalCode = rewrittenCode.startsWith('/* [AI') ? rewrittenCode : `${healBanner}\n${rewrittenCode}`;
      
      setTranspiledCode(finalCode);
      setIsSelfHealedCode(true);
      setAiSelfHealing(true);
      setStatusMessage(`Self-Healing complete: Code rewritten to resolve ${heuristics.driftType}.`);
    } catch (err) {
      setIsError(true);
      setStatusMessage(`Self-Healing Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsRemediating(false);
    }
  };

  const hasGeneratedCode = transpiledCode.length > 0;

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 flex flex-col font-sans selection:bg-cyan-500">
      <header className="border-b border-slate-800 bg-[#0c1220] px-6 py-3.5 flex justify-between items-center sticky top-0 z-40">
        <div>
          <h1 className="text-base font-bold text-white flex items-center gap-1.5">
            Mainframe <span className="text-indigo-400">Modernisation Accelerator</span>
          </h1>
          <p className="text-[11px] text-slate-400">IMS • COBOL • JCL ➔ Cloud Native Engine</p>
        </div>
        <div className="flex gap-2">
          <div className="bg-[#111928] border border-slate-800 p-1 rounded-xl flex gap-1">
            <button onClick={() => setActiveTab('transpiler')} className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${activeTab === 'transpiler' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>
              <span>1. Code Conversion Engine</span>
              {isSelfHealedCode && <span className="w-2 h-2 rounded-full bg-emerald-400" title="Self-Healed Code Ready" />}
            </button>
            <button onClick={() => setActiveTab('scaffolder')} className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold ${activeTab === 'scaffolder' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>📁 2. Cloud Scaffolder</button>
            <button onClick={() => setActiveTab('dualrun')} className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${activeTab === 'dualrun' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>
              <span>📈 3. Architecture Validator</span>
              {hasGeneratedCode && !validationRun && <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />}
            </button>
          </div>
          <button onClick={() => setShowConfigModal(true)} className="bg-slate-800 border border-slate-700 px-3 py-1.5 rounded-xl text-xs text-slate-300">⚙️ Config</button>
        </div>
      </header>

      {statusMessage && (
        <div className={`px-6 py-2.5 text-xs flex justify-between ${isError ? 'bg-rose-950 border-b border-rose-800 text-rose-200' : 'bg-slate-900 border-b border-cyan-900/50 text-cyan-300'}`}>
          <span>{statusMessage}</span>
          <button onClick={() => setStatusMessage('')}>✕</button>
        </div>
      )}

      {activeTab === 'transpiler' && (
        <main className="flex-1 flex flex-col p-6 gap-4 w-full mx-auto">
          <div className="flex justify-between bg-[#111928] p-3 rounded-xl border border-slate-800 items-center">
            <div className="flex gap-2">
              <button onClick={handleTranspile} disabled={isLoading} className="bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 px-5 py-2 rounded-lg text-xs font-semibold shadow-md">
                {isLoading ? 'Processing...' : '▷ Run Cloud Translation'}
              </button>
            </div>
            <select value={activeTrackId} onChange={(e) => handleTrackChange(e.target.value)} className="bg-slate-950 text-slate-200 text-sm font-semibold px-4 py-2 rounded-lg border border-slate-700 outline-none w-1/3">
              {Object.values(MODERNISATION_TRACKS).map(track => (
                <option key={track.id} value={track.id}>{track.name}</option>
              ))}
            </select>
          </div>
          
          <div className="grid grid-cols-2 gap-4 flex-1">
            <div className="flex flex-col bg-[#111928] rounded-xl border border-slate-800">
              <div className="bg-[#0c1220] p-3 text-xs font-semibold text-slate-300 border-b border-slate-800">
                Source: {activeTrack.sourceLabel}
              </div>
              <textarea value={sourceCode} onChange={(e) => setSourceCode(e.target.value)} className="w-full flex-1 p-4 bg-transparent font-mono text-xs text-slate-200 outline-none" placeholder={activeTrack.placeholder} spellCheck={false} />
            </div>
            <div className="flex flex-col bg-[#111928] rounded-xl border border-slate-800">
              <div className="bg-[#0c1220] p-3 text-xs font-semibold text-indigo-400 border-b border-slate-800 flex justify-between items-center">
                <span>Target: {activeTrack.targetLabel}</span>
                {isSelfHealedCode && <span className="bg-emerald-500/15 text-emerald-300 text-[10px] px-2.5 py-0.5 rounded border border-emerald-500/30 font-semibold">⚡ Self-Healed Component</span>}
              </div>
              <textarea readOnly value={transpiledCode} className="w-full flex-1 p-4 bg-transparent font-mono text-xs text-slate-300 outline-none" placeholder="Cloud-native code will generate here..." spellCheck={false} />
            </div>
          </div>
        </main>
      )}

      {activeTab === 'scaffolder' && (
        <main className="flex-1 p-8 max-w-6xl mx-auto w-full">
          <div className="bg-[#111928] p-6 rounded-2xl border border-slate-800 mb-6">
            <h2 className="text-white font-bold mb-1 flex items-center gap-2"><span className="text-blue-400">📁</span> Enterprise Cloud Scaffolder</h2>
            <p className="text-xs text-slate-400">Maps legacy monolithic structures into distributed cloud architectures.</p>
          </div>
          {hasGeneratedCode ? (
            <div className="bg-[#111928] p-6 rounded-2xl border border-slate-800 font-mono text-xs space-y-1.5">
              {activeTrackId === 'logic' && (
                <>
                  <div className="text-cyan-400 font-bold">java-microservice-repo/</div>
                  <div className="pl-4 text-slate-400">├── pom.xml (Spring Boot Dependencies)</div>
                  <div className="pl-4 text-cyan-400">├── src/main/java/com/bank/migration/</div>
                  <div className="pl-8 text-slate-300">├── controller/</div>
                  <div className="pl-12 text-emerald-400 font-bold">├── ModernisedController.java</div>
                  <div className="pl-8 text-slate-300">├── service/</div>
                  <div className="pl-12 text-slate-400">├── BusinessLogicService.java</div>
                  <div className="pl-8 text-slate-300">└── repository/</div>
                  <div className="pl-12 text-slate-400">└── ImsDataRepository.java</div>
                </>
              )}
              {activeTrackId === 'schema' && (
                <>
                  <div className="text-cyan-400 font-bold">postgres-migration-repo/</div>
                  <div className="pl-4 text-slate-400">├── flyway-migrations/</div>
                  <div className="pl-8 text-emerald-400 font-bold">├── V1__Create_Flattened_Tables.sql</div>
                  {heuristics.driftType && (
                     <div className="pl-8 text-amber-400">├── V2__Add_EBCDIC_Translation_Functions.sql</div>
                  )}
                </>
              )}
              {activeTrackId === 'orchestration' && (
                <>
                  <div className="text-cyan-400 font-bold">airflow-orchestration-repo/</div>
                  <div className="pl-4 text-slate-400">├── dags/</div>
                  <div className="pl-8 text-emerald-400 font-bold">├── converted_mainframe_batch_dag.py</div>
                  <div className="pl-4 text-slate-400">├── plugins/</div>
                  <div className="pl-8 text-slate-400">└── s3_file_transfer_hooks.py</div>
                </>
              )}
            </div>
          ) : (
             <div className="p-16 text-center text-slate-400 text-xs bg-[#111928] rounded-2xl border border-slate-800">Run translation to view projected repository structure.</div>
          )}
        </main>
      )}

      {activeTab === 'dualrun' && (
        <main className="flex-1 p-8 max-w-6xl mx-auto w-full space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-[#111928] border border-slate-800 rounded-2xl p-5 shadow-xl">
              <div className="text-[11px] font-bold text-slate-400 uppercase mb-2">TARGET READINESS</div>
              <div className={`text-2xl font-black ${validationRun && heuristics.driftType && !aiSelfHealing ? 'text-rose-400' : 'text-white'}`}>
                {validationRun ? (heuristics.driftType && !aiSelfHealing ? 'CRITICAL DRIFT' : 'PRODUCTION READY') : 'PENDING'}
              </div>
            </div>
            <div className="bg-[#111928] border border-slate-800 rounded-2xl p-5 shadow-xl">
              <div className="text-[11px] font-bold text-slate-400 uppercase mb-2">COMPONENTS VERIFIED</div>
              <div className="text-2xl font-black text-white">{validationRun ? '1 / 1' : '0 / 0'}</div>
            </div>
            <div className="bg-[#111928] border border-slate-800 rounded-2xl p-5 shadow-xl">
              <div className="text-[11px] font-bold text-slate-400 uppercase mb-2">MIGRATION PARITY SCORE</div>
              <div className={`text-2xl font-black ${validationRun && heuristics.driftType && !aiSelfHealing ? 'text-rose-400' : 'text-white'}`}>
                {validationRun ? (aiSelfHealing ? '100.00%' : heuristics.parityScore) : '0.00%'}
              </div>
            </div>
          </div>

          <div className="bg-[#111928] border border-slate-800 rounded-2xl shadow-xl">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2"><span className="text-indigo-400">⚖️</span> Anti-Pattern & Drift Analysis</h3>
              <div className="flex items-center space-x-3">
                <span className="text-[11px] font-bold uppercase text-slate-400">AI Self-Healing Engine</span>
                <button onClick={() => { if (!aiSelfHealing) triggerSelfHealingRemediation(); }} disabled={!heuristics.driftType || isRemediating || aiSelfHealing} className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors ${aiSelfHealing ? 'bg-emerald-600' : 'bg-slate-800'}`}>
                  <div className={`bg-white w-4 h-4 rounded-full transform transition-transform ${aiSelfHealing ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            </div>
            
            {hasGeneratedCode && validationRun ? (
              <div className="grid grid-cols-4 px-6 py-4 items-center text-xs text-slate-300 gap-2">
                <div className="font-mono text-cyan-300">Generated Asset</div>
                <div>
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${!heuristics.driftType || aiSelfHealing ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>
                    {!heuristics.driftType || aiSelfHealing ? 'Parity Verified' : heuristics.driftType}
                  </span>
                </div>
                <div className={`font-mono font-bold ${!heuristics.driftType || aiSelfHealing ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {!heuristics.driftType || aiSelfHealing ? '100.00%' : heuristics.parityScore}
                </div>
                <div className="flex flex-col gap-1.5 items-start">
                  {!heuristics.driftType ? (
                    <span className="text-slate-400">Zero divergence confirmed</span>
                  ) : aiSelfHealing ? (
                    <>
                      <span className="text-emerald-300">{heuristics.healAction}</span>
                      <button onClick={() => setActiveTab('transpiler')} className="bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 px-2.5 py-1 rounded text-[11px] font-semibold">
                        Inspect Patched Code ➔
                      </button>
                    </>
                  ) : (
                    <button onClick={triggerSelfHealingRemediation} disabled={isRemediating} className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-3 py-1 rounded text-[11px] font-medium">
                      {isRemediating ? 'Refactoring Code...' : '⚡ Self-Heal Code'}
                    </button>
                  )}
                </div>
              </div>
            ) : (
               <div className="py-16 text-center text-xs text-slate-400">
                {hasGeneratedCode ? <button onClick={() => setValidationRun(true)} className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2 rounded-xl">Run Architecture Profiler</button> : "Run translation first."}
              </div>
            )}
          </div>

          <div className="bg-[#111928] border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
            <div className="px-6 py-3 border-b border-slate-800"><span className="text-[11px] font-bold uppercase text-slate-400">Autonomous Remediation Terminal</span></div>
            <div className="p-5 font-mono text-xs text-slate-400 bg-slate-950/60 min-h-[100px] leading-relaxed">
              {validationRun ? (
                heuristics.driftType ? (
                  aiSelfHealing ? (
                    <div className="space-y-1 text-emerald-300">
                      <p className="text-cyan-400">[info] {heuristics.terminalDriftLog}</p>
                      <p className="text-indigo-400">{heuristics.terminalHealLog}</p>
                      <p className="text-emerald-400 font-semibold">[success] Cloud deployment readiness verified.</p>
                    </div>
                  ) : (
                    <div className="space-y-1 text-slate-300">
                      <p className="text-cyan-400">[info] Analyzing cloud-native target architecture...</p>
                      <p className="text-rose-400">{heuristics.terminalDriftLog}</p>
                      <p className="text-slate-400">[info] Click '⚡ Self-Heal Code' to rewrite the code and resolve the anti-pattern.</p>
                    </div>
                  )
                ) : (
                  <div className="space-y-1 text-slate-300">
                    <p className="text-cyan-400">[info] Analyzing target architecture...</p>
                    <p className="text-emerald-400">[success] Zero divergence detected. Ready for cloud deployment.</p>
                  </div>
                )
              ) : <p>Waiting for agent activation...</p>}
            </div>
          </div>
        </main>
      )}

      {showConfigModal && (
        <div className="fixed inset-0 bg-slate-950/80 flex items-center justify-center p-4 z-50">
          <div className="bg-[#111928] p-6 rounded-2xl border border-slate-800 max-w-md w-full flex flex-col gap-4 text-xs">
            <h3 className="font-bold text-white">Backend Configuration</h3>
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Gemini API Key" className="bg-slate-950 p-2 text-white border border-slate-700 rounded outline-none" />
            <button onClick={handleSaveConfig} className="bg-indigo-600 text-white p-2 rounded font-semibold">Save</button>
          </div>
        </div>
      )}
    </div>
  );
}
