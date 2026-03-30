require('dotenv').config();
const express = require('express');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const sessionsFile = path.join(__dirname, 'sessions.json');
const aiderCommand = '/home/cuongnguyen1/.local/bin/aider';
const runningProcesses = new Map();

function expandHome(pathStr) {
    if (!pathStr) return "";
    if (pathStr.startsWith('~')) { return path.join(os.homedir(), pathStr.slice(1)); }
    return pathStr;
}

function loadSessions() {
    if (fs.existsSync(sessionsFile)) {
        try { 
            let sessions = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
            const now = new Date();
            const filteredSessions = {};
            let changed = false;
            Object.values(sessions).forEach(s => {
                const updatedDate = new Date(s.updatedAt);
                if ((now - updatedDate) / (1000 * 60 * 60 * 24) <= 14) filteredSessions[s.id] = s;
                else changed = true;
            });
            if (changed) saveSessions(filteredSessions);
            return filteredSessions;
        } catch (e) { console.error("Error loading sessions.json", e); }
    }
    return {};
}

function saveSessions(sessions) {
    fs.writeFileSync(sessionsFile, JSON.stringify(sessions, null, 2));
}

app.get('/api/sessions', (req, res) => {
    const sessions = loadSessions();
    res.json(Object.values(sessions).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)));
});

app.delete('/api/sessions/:id', (req, res) => {
    const { id } = req.params;
    const sessions = loadSessions();
    const session = sessions[id];
    if (session) {
        const process = runningProcesses.get(id);
        if (process) process.kill('SIGTERM');
        const projectPath = expandHome(session.projectPath);
        const historyFile = path.join(projectPath, `.aider.chat.history.${id}.md`);
        const inputFile = path.join(projectPath, `.aider.input.history.${id}`);
        if (fs.existsSync(historyFile)) fs.unlinkSync(historyFile);
        if (fs.existsSync(inputFile)) fs.unlinkSync(inputFile);
        delete sessions[id];
        saveSessions(sessions);
        return res.json({ success: true });
    }
    res.status(404).json({ error: 'Not found' });
});

app.post('/api/stop-agent', (req, res) => {
    const { sessionId } = req.body;
    const process = runningProcesses.get(sessionId);
    if (process) {
        process.kill('SIGTERM');
        runningProcesses.delete(sessionId);
        return res.json({ success: true });
    }
    res.status(404).json({ error: 'Not found' });
});

app.post('/api/run-command', (req, res) => {
    const { sessionId, commandType } = req.body;
    const sessions = loadSessions();
    const session = sessions[sessionId];
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const projectPath = expandHome(session.projectPath);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    let shellCommand = '';
    if (commandType === 'push') {
        try {
            const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectPath }).toString().trim();
            shellCommand = `git push ssh-tda ${currentBranch}`;
            res.write(`🚀 Executing: ${shellCommand}\n\n`);
        } catch (e) { return res.end(`❌ Git Error: ${e.message}`); }
    }
    const process = spawn(shellCommand, { shell: true, cwd: projectPath });
    process.stdout.on('data', (d) => res.write(d));
    process.stderr.on('data', (d) => res.write(d));
    process.on('close', (c) => { res.write(`\n\n=== FINISHED (${c}) ===\n`); res.end(); });
});

app.post('/api/generate-branch', async (req, res) => {
    const { issueContent, gitType, username, issueCode } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!issueContent || !apiKey) return res.json({ branchName: "error-missing-info" });
    const actualGitType = gitType === 'feature' ? 'feat' : 'fix';
    const prompt = `Translate this Vietnamese technical issue into a very short English slug (max 5 words, lowercase, hyphenated): "${issueContent}". Output ONLY the slug, no other text.`;
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const data = await response.json();
        if (data.error) return res.json({ branchName: `${actualGitType}/tda/${username}/${issueCode.toLowerCase()}-error-api` });
        const slug = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || "task";
        res.json({ branchName: `${actualGitType}/tda/${username}/${issueCode.toLowerCase()}-${slug}` });
    } catch (e) { res.json({ branchName: `${actualGitType}/tda/${username}/${issueCode.toLowerCase()}-fallback` }); }
});

app.post('/api/run-agent', (req, res) => {
    let { sessionId, taskMode, projectPath, instruction, referenceFiles, gitType, username, issueCode, isFollowUp, branchName: customBranchName } = req.body;
    projectPath = expandHome(projectPath);
    if (taskMode !== 'discovery' && (!username || !issueCode)) return res.status(400).json({ error: 'Git info required for fix mode.' });
    if (!projectPath) return res.status(400).json({ error: 'Project Path is required.' });
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(400).json({ error: 'API_KEY missing' });

    if (!sessionId) sessionId = crypto.randomUUID().substring(0, 8);
    const sessions = loadSessions();
    sessions[sessionId] = { id: sessionId, projectPath, username, issueCode, taskMode, updatedAt: new Date().toISOString(), title: sessions[sessionId]?.title || instruction.substring(0, 50) + "..." };
    saveSessions(sessions);

    const actualGitType = gitType === 'feature' ? 'feat' : 'fix';
    const slug = instruction.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 20);
    const branchName = customBranchName || `${gitType}/tda/${username}/${issueCode?.toLowerCase() || 'discovery'}-${slug}`;

    let contextRules = "";
    const localTemplateDir = path.join(projectPath, 'ai-centric-template');
    if (fs.existsSync(localTemplateDir)) {
        fs.readdirSync(localTemplateDir).forEach(file => {
            if (file.endsWith('.md')) {
                contextRules += `\n--- RULE FILE: ${file} ---\n` + fs.readFileSync(path.join(localTemplateDir, file), 'utf8') + "\n";
            }
        });
    }

    const chatHistoryFile = path.join(projectPath, `.aider.chat.history.${sessionId}.md`);
    if (instruction.toLowerCase().includes("reset") && fs.existsSync(chatHistoryFile)) fs.unlinkSync(chatHistoryFile);

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.write(`🆔 SESSION: ${sessionId} | 🕵️ MODE: ${taskMode === 'discovery' ? 'Discovery' : 'Fix Code'}\n`);

    res.write(`--------------------------------------------------------------------------------\n\n`);

    let systemDirectives = "";
    if (taskMode === 'discovery') {
        systemDirectives = `
BẠN LÀ SENIOR SOFTWARE ARCHITECT. NHIỆM VỤ: PHÂN TÍCH SOURCE CODE CHO LẬP TRÌNH VIÊN MỚI.
[YÊU CẦU QUAN TRỌNG]: 
- BẠN CHỈ ĐƯỢC PHÉP ĐỌC FILE VÀ PHÂN TÍCH. 
- TUYỆT ĐỐI KHÔNG ĐƯỢC SỬA FILE, KHÔNG ĐƯỢC TẠO KHỐI SEARCH/REPLACE.
- KHÔNG THỰC HIỆN BẤT KỲ LỆNH GIT NÀO.

[CẦN LÀM RÕ]:
1. Framework & Version: Xác định từ cấu hình (vd: package.json, go.mod).
2. Cấu trúc thư mục: Giải thích ý nghĩa các folder chính.
3. Luồng chính & Auth: Tìm cơ chế Login, Middleware, Permission.
4. Chức năng chính: Liệt kê các nghiệp vụ quan trọng.
5. Hotspots: File nào gọi nhiều API nhất? Logic tập trung ở đâu?
[CHỈ THỊ]: Trình bày Tiếng Việt, dùng Markdown chuyên nghiệp. 
`;
    } else {
        systemDirectives = `
BẠN LÀ AI SOFTWARE ENGINEER. BẠN ĐANG ĐIỀU KHIỂN TERMINAL QUA AIDER.
[QUY TẮC BẮT BUỘC]:
1. TUYỆT ĐỐI KHÔNG comment code cũ. Xóa mã cũ, thay mã mới.
2. 100% ENGLISH TRONG FILE CODE. CẤM Tiếng Việt trong file.
3. TRUY VẾT LOGIC: Tự tìm file liên quan từ Repo Map dựa trên URL/Chức năng.
4. LUÔN ĐỌC FILE TRƯỚC khi sửa.
[DỰ ÁN]: ${contextRules}
[CHỈ THỊ]: Phản hồi Tiếng Việt trong chat. Thực hiện ngay bằng SEARCH/REPLACE.
`;
    }

    const fullPrompt = `${systemDirectives}\n\n[YÊU CẦU]: ${instruction}`;
    let aiderArgs = [
        '--model', 'gemini/gemini-2.5-flash', '--architect', '--yes', '--chat-language', 'Vietnamese', '--map-tokens', '4096',
        '--no-check-update', '--cache-prompts', '--suggest-shell-commands',
        '--chat-history-file', chatHistoryFile,
        '--input-history-file', path.join(projectPath, `.aider.input.history.${sessionId}`),
        '--set-env', 'GOOGLE_API_KEY=' + apiKey,
        '--message', fullPrompt
    ];

    aiderArgs.push('--no-auto-commits', '--no-dirty-commits');

    const fileRegex = /([a-zA-Z0-9_\-\/]+\.(?:tsx|ts|js|jsx|php|go|md|txt))/g;
    let allFiles = new Set(instruction.match(fileRegex) || []);
    if (referenceFiles) referenceFiles.split(',').forEach(f => { if(f.trim()) allFiles.add(f.trim()); });
    allFiles.forEach(f => {
        const fullPath = path.isAbsolute(f) ? f : path.join(projectPath, f);
        if (fs.existsSync(fullPath)) aiderArgs.push(f);
    });

    const agentProcess = spawn(aiderCommand, aiderArgs, {
        cwd: projectPath, env: { ...process.env, GEMINI_API_KEY: apiKey, PYTHONIOENCODING: 'utf8' }
    });

    runningProcesses.set(sessionId, agentProcess);
    agentProcess.stdout.on('data', (d) => res.write(d));
    agentProcess.stderr.on('data', (d) => res.write(d));
    agentProcess.on('close', (c) => { runningProcesses.delete(sessionId); res.write(`\n\n=== FINISHED (${c}) ===\n`); res.end(); });
});

app.listen(3002, () => console.log(`🚀 Multi-Session AI Agent: http://localhost:3002`));
