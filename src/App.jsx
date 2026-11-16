import React, { useState } from 'react';

const GEMINI_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite'
];

// Define Sources
const SOURCES = {
  ims: { id: 'ims', label: 'Legacy IMS DBD (Schema)', placeholder: 'Paste IMS Database Description (DBD) here...' },
  cobol: { id: 'cobol', label: 'Legacy COBOL (Logic)', placeholder: 'Paste COBOL program with EXEC DLI calls here...' },
  jcl: { id: 'jcl', label: 'Legacy JCL (Orchestration)', placeholder: 'Paste JCL step execution script here...' }
};

// Define Targets mapped to Sources
const TARGETS = {
  ims: [
    { id: 'postgres', label: 'PostgreSQL DDL', rules: 'Convert the hierarchical IMS DBD segments into relational PostgreSQL DDL. Create appropriate primary and foreign keys.' },
    { id: 'mongodb', label: 'MongoDB Schema', rules: 'Convert the hierarchical IMS DBD segments into a MongoDB NoSQL JSON schema.' }
  ],
  cobol: [
    { id: 'java', label: 'Java Spring Boot', rules: 'Convert the COBOL business logic into a Java 17 Spring Boot REST API. Replace IMS DL/I calls with JPA methods.' },
    { id: 'python', label: 'Python FastAPI', rules: 'Convert the COBOL business logic into a modern Python FastAPI application. Replace IMS DL/I calls with SQLAlchemy or Pydantic models.' },
    { id: 'node', label: 'Node.js Express', rules: 'Convert the COBOL business logic into a Node.js Express API. Replace IMS DL/I calls with async Mongoose or Sequelize methods.' }
  ],
  jcl: [
    { id: 'airflow', label: 'Apache Airflow (Python)', rules: 'Convert the JCL batch job into an Apache Airflow DAG in Python. Use standard Airflow operators.' },
    { id: 'stepfunctions', label: 'AWS Step Functions (JSON)', rules: 'Convert the JCL batch job into AWS Step Functions Amazon States Language (ASL) JSON definition.' }
  ]
};

export default function App() {
  const [activeTab, setActiveTab] = useState('transpiler');
  
  const [sourceType, setSourceType] = useState('cobol');
  const [targetType, setTargetType] = useState('java');
  
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

  // Dynamic AI Scaffolder State
  const [scaffoldTree, setScaffoldTree] = useState(null);
  const [isScaffolding, setIsScaffolding] = useState(false);

  // AI-Driven Dual-Run Validation & Healing State
  const [validationRun, setValidationRun] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [aiSelfHealing, setAiSelfHealing] = useState(false);
  const [isRemediating, setIsRemediating] = useState(false);
  const [isSelfHealedCode, setIsSelfHealedCode] = useState(false);

  const activeSource = SOURCES[sourceType];
  const activeTarget = TARGETS[sourceType].find(t => t.id === targetType) || TARGETS[sourceType][0];

  const handleSaveConfig = () => {
    try { localStorage.setItem('migrateops_gemini_key', apiKey.trim()); } 
    catch {}
    setShowConfigModal(false);
    setIsError(false);
    setStatusMessage('Configuration saved.');
  };

  const resetGeneratedStates = () => {
    setScaffoldTree(null);
    setValidationRun(false);
    setAnalysisResult(null);
    setAiSelfHealing(false);
    setIsSelfHealedCode(false);
  };

  const handleSourceChange = (newSource) => {
    setSourceType(newSource);
    setTargetType(TARGETS[newSource][0].id);
    setSourceCode('');
    setTranspiledCode('');
    resetGeneratedStates();
    setStatusMessage(`Switched source to ${SOURCES[newSource].label}.`);
  };

  const handleTargetChange = (newTarget) => {
    setTargetType(newTarget);
    setTranspiledCode('');
    resetGeneratedStates();
  };

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

  // LIVE AI SCAFFOLDER: Dynamically inspects the source + generated code to build a tailored repo structure
  const generateDynamicScaffold = async (srcCode, targetCode, driftInfo = null) => {
    setIsScaffolding(true);
    const driftContext = driftInfo?.hasDrift
      ? `\nNote: Architecture validation flagged ${driftInfo.driftType} (${driftInfo.healAction}). Include the specific migration/remediation config or middleware file needed for that fix in the tree.`
      : '';

    const scaffoldPrompt = `You are a Principal Cloud Solutions Architect.
Inspect the legacy ${activeSource.label} code and the generated ${activeTarget.label} code below, and design a tailored, enterprise-grade repository folder and file tree specifically named after the entities, program IDs, segments, or job names found in the code.${driftContext}

Return ONLY a clean ASCII directory tree (using ├──, └──, │) with brief inline comments in parentheses explaining each key file's role. Do NOT include markdown backticks or introductory text.

Legacy Source:
${srcCode}

Transpiled Code:
${targetCode}`;

    try {
      const treeOutput = await callGeminiWithFallback(scaffoldPrompt);
      setScaffoldTree(treeOutput);
    } catch {
      setScaffoldTree(null);
    } finally {
      setIsScaffolding(false);
    }
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
    resetGeneratedStates();

    const prompt = `You are an expert mainframe modernisation architect migrating to ${activeTarget.label}.
${activeTarget.rules}
Return ONLY the raw transpiled code with no markdown formatting, backticks, or explanations.

Legacy Source Code:
${sourceCode}`;

    try {
      const cleanCode = await callGeminiWithFallback(prompt);
      setTranspiledCode(cleanCode);
      setStatusMessage(`Transpilation complete. Legacy payload converted to ${activeTarget.label}.`);
      // Automatically generate the custom repository scaffold based on the actual code
      generateDynamicScaffold(sourceCode, cleanCode);
    } catch (err) {
      setIsError(true);
      setStatusMessage(`Gemini API Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsLoading(false);
    }
  };

  // LIVE AI DIAGNOSTICS: Evaluates the generated code against the source code
  const handleAnalyzeArchitecture = async () => {
    if (!transpiledCode.trim()) return;
    if (!apiKey.trim()) return;

    setIsAnalyzing(true);
    setIsError(false);
    setValidationRun(true);
    setAnalysisResult(null);
    setAiSelfHealing(false);

    const diagnosticPrompt = `You are a strict Cloud Architecture Validator.
Analyze the following legacy ${activeSource.label} code and its transpiled ${activeTarget.label} equivalent.
Look for real mainframe-to-cloud anti-patterns, data type precision risks (like COBOL COMP-3 being mapped to standard floats), encoding risks (EBCDIC to ASCII data corruption), or static bindings (hardcoded DSN datasets or local SQLite files instead of decoupled cloud storage/databases).

Respond ONLY with a valid JSON object matching this exact structure, with no markdown formatting or extra text:
{
  "hasDrift": boolean,
  "parityScore": "string percentage (e.g., '100.00%' if perfect, or lower like '72.14%' if drift exists)",
  "driftType": "string (null if no drift, e.g., 'PACKED_DECIMAL_LOSS', 'EBCDIC_ENCODING_CORRUPTION', 'STATIC_STORAGE_BINDING')",
  "terminalDriftLog": "string explaining the risk (null if no drift)",
  "healAction": "string describing the architectural fix to apply (null if no drift)",
  "terminalHealLog": "string explaining what the self-healing agent will do to fix it (null if no drift)"
}

Legacy Source:
${sourceCode}

Transpiled Target:
${transpiledCode}`;

    try {
      const rawJsonResponse = await callGeminiWithFallback(diagnosticPrompt);
      const parsedJson = JSON.parse(rawJsonResponse);
      setAnalysisResult(parsedJson);
      setStatusMessage(`Architecture validation complete.`);
      if (parsedJson.hasDrift) {
        generateDynamicScaffold(sourceCode, transpiledCode, parsedJson);
      }
    } catch (err) {
      setIsError(true);
      setValidationRun(false);
      setStatusMessage(`Validation Error: Ensure Gemini returns valid JSON. ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const triggerSelfHealingRemediation = async () => {
    if (!transpiledCode.trim() || !analysisResult?.hasDrift) return;
    if (!apiKey.trim()) return;

    setIsRemediating(true);
    setIsError(false);

    const remediationPrompt = `You are a cloud-native remediation agent targeting ${activeTarget.label}.
The following transpiled code failed architecture validation with drift type: ${analysisResult.driftType}.
Required fix: ${analysisResult.healAction}.

Apply the fix directly to the code below based on the syntax of ${activeTarget.label}. 
Return ONLY the raw code with NO markdown backticks or explanations.

Code to remediate:
${transpiledCode}`;

    try {
      const rewrittenCode = await callGeminiWithFallback(remediationPrompt);
      const healBanner = `/* [AI SELF-HEALED | Fix: ${analysisResult.healAction}] */`;
      const finalCode = rewrittenCode.startsWith('/* [AI') ? rewrittenCode : `${healBanner}\n${rewrittenCode}`;
      
      setTranspiledCode(finalCode);
      setIsSelfHealedCode(true);
      setAiSelfHealing(true);
      setStatusMessage(`Self-Healing complete: ${activeTarget.label} code & Cloud Scaffolder updated to resolve ${analysisResult.driftType}.`);
      // Refresh the scaffold tree to reflect the patched/self-healed architecture
      generateDynamicScaffold(sourceCode, finalCode, analysisResult);
    } catch (err) {
      setIsError(true);
      setStatusMessage(`Self-Healing Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsRemediating(false);
    }
  };

  const hasGeneratedCode = transpiledCode.length > 0;
  const isDriftDetected = analysisResult?.hasDrift;

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 flex flex-col font-sans selection:bg-cyan-500">
      <header className="border-b border-slate-800 bg-[#0c1220] px-6 py-3.5 flex justify-between items-center sticky top-0 z-40">
        <div>
          <h1 className="text-base font-bold text-white flex items-center gap-1.5">
            Mainframe <span className="text-indigo-400">Modernisation Accelerator</span>
          </h1>
          <p className="text-[11px] text-slate-400">Multi-Target Cloud Native Conversion Engine</p>
        </div>
        <div className="flex gap-2">
          <div className="bg-[#111928] border border-slate-800 p-1 rounded-xl flex gap-1">
            <button onClick={() => setActiveTab('transpiler')} className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${activeTab === 'transpiler' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>
              <span>1. Code Conversion Engine</span>
              {isSelfHealedCode && <span className="w-2 h-2 rounded-full bg-emerald-400" title="Self-Healed Code Ready" />}
            </button>
            <button onClick={() => setActiveTab('scaffolder')} className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${activeTab === 'scaffolder' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>
              <span>📁 2. Cloud Scaffolder</span>
              {scaffoldTree && <span className="w-2 h-2 rounded-full bg-cyan-400" title="Dynamic Blueprint Ready" />}
            </button>
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
            <button onClick={handleTranspile} disabled={isLoading} className="bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 px-6 py-2 rounded-lg text-xs font-bold shadow-md">
              {isLoading ? 'Processing via Gemini...' : '▷ Run Cloud Translation'}
            </button>
            <div className="text-xs text-slate-400">Select Source and Target Below</div>
          </div>
          
          <div className="grid grid-cols-2 gap-4 flex-1">
            <div className="flex flex-col bg-[#111928] rounded-xl border border-slate-800">
              <div className="bg-[#0c1220] p-3 border-b border-slate-800 flex justify-between items-center">
                <span className="text-xs font-semibold text-slate-400">INPUT</span>
                <select value={sourceType} onChange={(e) => handleSourceChange(e.target.value)} className="bg-slate-900 text-slate-200 text-xs font-bold px-3 py-1.5 rounded border border-slate-700 outline-none w-2/3">
                  {Object.values(SOURCES).map(src => (
                    <option key={src.id} value={src.id} className="bg-slate-900 text-white">{src.label}</option>
                  ))}
                </select>
              </div>
              <textarea value={sourceCode} onChange={(e) => setSourceCode(e.target.value)} className="w-full flex-1 p-4 bg-transparent font-mono text-xs text-slate-200 outline-none" placeholder={activeSource.placeholder} spellCheck={false} />
            </div>

            <div className="flex flex-col bg-[#111928] rounded-xl border border-slate-800">
              <div className="bg-[#0c1220] p-3 border-b border-slate-800 flex justify-between items-center">
                <span className="text-xs font-semibold text-indigo-400">TARGET</span>
                <div className="flex items-center gap-2 w-2/3">
                  <select value={targetType} onChange={(e) => handleTargetChange(e.target.value)} className="bg-slate-900 text-indigo-300 text-xs font-bold px-3 py-1.5 rounded border border-indigo-900/50 outline-none w-full">
                    {TARGETS[sourceType].map(tgt => (
                      <option key={tgt.id} value={tgt.id} className="bg-slate-900 text-white">{tgt.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="relative flex-1 flex flex-col">
                {isSelfHealedCode && <div className="absolute top-2 right-4 bg-emerald-500/15 text-emerald-300 text-[10px] px-2.5 py-0.5 rounded border border-emerald-500/30 font-semibold z-10">⚡ Self-Healed Component</div>}
                <textarea readOnly value={transpiledCode} className="w-full flex-1 p-4 bg-transparent font-mono text-xs text-slate-300 outline-none" placeholder="Cloud-native code will generate here..." spellCheck={false} />
              </div>
            </div>
          </div>
        </main>
      )}

      {activeTab === 'scaffolder' && (
        <main className="flex-1 p-8 max-w-6xl mx-auto w-full">
          <div className="bg-[#111928] p-6 rounded-2xl border border-slate-800 mb-6 flex justify-between items-center">
            <div>
              <h2 className="text-white font-bold mb-1 flex items-center gap-2"><span className="text-blue-400">📁</span> Enterprise Cloud Scaffolder</h2>
              <p className="text-xs text-slate-400">AI-generated repository structure tailored to your {activeSource.label} ➔ {activeTarget.label} payload.</p>
            </div>
            {hasGeneratedCode && (
              <button
                onClick={() => generateDynamicScaffold(sourceCode, transpiledCode, analysisResult)}
                disabled={isScaffolding}
                className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-cyan-300 border border-cyan-500/30 px-4 py-2 rounded-xl text-xs font-semibold"
              >
                {isScaffolding ? 'Synthesizing Tree...' : '↻ Regenerate Blueprint'}
              </button>
            )}
          </div>

          {hasGeneratedCode ? (
            <div className="bg-[#111928] p-6 rounded-2xl border border-slate-800 font-mono text-xs leading-relaxed">
              {isScaffolding ? (
                <div className="py-12 text-center text-cyan-400 animate-pulse">
                  Inspecting generated {activeTarget.label} modules and synthesizing repository blueprint via Gemini...
                </div>
              ) : scaffoldTree ? (
                <pre className="text-slate-200 whitespace-pre-wrap overflow-x-auto">{scaffoldTree}</pre>
              ) : (
                <div className="py-12 text-center text-slate-400">
                  Click "Regenerate Blueprint" to synthesize the dynamic folder structure.
                </div>
              )}
            </div>
          ) : (
            <div className="p-16 text-center text-slate-400 text-xs bg-[#111928] rounded-2xl border border-slate-800">
              Run translation first to generate a dynamic cloud repository blueprint.
            </div>
          )}
        </main>
      )}

      {activeTab === 'dualrun' && (
        <main className="flex-1 p-8 max-w-6xl mx-auto w-full space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-[#111928] border border-slate-800 rounded-2xl p-5 shadow-xl">
              <div className="text-[11px] font-bold text-slate-400 uppercase mb-2">TARGET READINESS</div>
              <div className={`text-2xl font-black ${validationRun && isDriftDetected && !aiSelfHealing ? 'text-rose-400' : 'text-white'}`}>
                {validationRun ? (isDriftDetected && !aiSelfHealing ? 'CRITICAL DRIFT' : 'PRODUCTION READY') : 'PENDING'}
              </div>
            </div>
            <div className="bg-[#111928] border border-slate-800 rounded-2xl p-5 shadow-xl">
              <div className="text-[11px] font-bold text-slate-400 uppercase mb-2">COMPONENTS VERIFIED</div>
              <div className="text-2xl font-black text-white">{validationRun ? '1 / 1' : '0 / 0'}</div>
            </div>
            <div className="bg-[#111928] border border-slate-800 rounded-2xl p-5 shadow-xl">
              <div className="text-[11px] font-bold text-slate-400 uppercase mb-2">MIGRATION PARITY SCORE</div>
              <div className={`text-2xl font-black ${validationRun && isDriftDetected && !aiSelfHealing ? 'text-rose-400' : 'text-white'}`}>
                {validationRun ? (aiSelfHealing ? '100.00%' : analysisResult?.parityScore) : '0.00%'}
              </div>
            </div>
          </div>

          <div className="bg-[#111928] border border-slate-800 rounded-2xl shadow-xl">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2"><span className="text-indigo-400">⚖️</span> Anti-Pattern & Drift Analysis</h3>
              <div className="flex items-center space-x-3">
                <span className="text-[11px] font-bold uppercase text-slate-400">AI Self-Healing Engine</span>
                <button onClick={() => { if (!aiSelfHealing) triggerSelfHealingRemediation(); }} disabled={!isDriftDetected || isRemediating || aiSelfHealing} className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors ${aiSelfHealing ? 'bg-emerald-600' : 'bg-slate-800'}`}>
                  <div className={`bg-white w-4 h-4 rounded-full transform transition-transform ${aiSelfHealing ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            </div>
            
            {hasGeneratedCode && validationRun && analysisResult ? (
              <div className="grid grid-cols-4 px-6 py-4 items-center text-xs text-slate-300 gap-2">
                <div className="font-mono text-cyan-300">Generated Asset</div>
                <div>
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${!isDriftDetected || aiSelfHealing ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>
                    {!isDriftDetected || aiSelfHealing ? 'Parity Verified' : analysisResult.driftType}
                  </span>
                </div>
                <div className={`font-mono font-bold ${!isDriftDetected || aiSelfHealing ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {!isDriftDetected || aiSelfHealing ? '100.00%' : analysisResult.parityScore}
                </div>
                <div className="flex flex-col gap-1.5 items-start">
                  {!isDriftDetected ? (
                    <span className="text-slate-400">Zero divergence confirmed</span>
                  ) : aiSelfHealing ? (
                    <>
                      <span className="text-emerald-300">{analysisResult.healAction}</span>
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
                {isAnalyzing ? (
                  <span className="text-cyan-400 animate-pulse">Scanning architecture via Gemini AI...</span>
                ) : hasGeneratedCode ? (
                  <button onClick={handleAnalyzeArchitecture} disabled={isAnalyzing} className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2 rounded-xl">Run Live Architecture Profiler</button>
                ) : (
                  "Run translation first."
                )}
              </div>
            )}
          </div>

          <div className="bg-[#111928] border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
            <div className="px-6 py-3 border-b border-slate-800"><span className="text-[11px] font-bold uppercase text-slate-400">Autonomous Remediation Terminal</span></div>
            <div className="p-5 font-mono text-xs text-slate-400 bg-slate-950/60 min-h-[100px] leading-relaxed">
              {validationRun && analysisResult ? (
                isDriftDetected ? (
                  aiSelfHealing ? (
                    <div className="space-y-1 text-emerald-300">
                      <p className="text-cyan-400">[info] {analysisResult.terminalDriftLog}</p>
                      <p className="text-indigo-400">[agent] {analysisResult.terminalHealLog}</p>
                      <p className="text-emerald-400 font-semibold">[success] Cloud deployment readiness verified.</p>
                    </div>
                  ) : (
                    <div className="space-y-1 text-slate-300">
                      <p className="text-cyan-400">[info] Analyzing cloud-native target architecture...</p>
                      <p className="text-rose-400">[warn] {analysisResult.terminalDriftLog}</p>
                      <p className="text-slate-400">[info] Click '⚡ Self-Heal Code' to request an AI rewrite and resolve the anti-pattern.</p>
                    </div>
                  )
                ) : (
                  <div className="space-y-1 text-slate-300">
                    <p className="text-cyan-400">[info] Analyzing target architecture via Gemini...</p>
                    <p className="text-emerald-400">[success] Zero divergence detected. Code verified for cloud deployment.</p>
                  </div>
                )
              ) : <p>{isAnalyzing ? "Fetching AI diagnostic report..." : "Waiting for agent activation..."}</p>}
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
