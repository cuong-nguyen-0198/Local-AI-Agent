require('dotenv').config();
const express = require('express');
const { spawn } = require('child_process');
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
            return JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
        } catch (e) {
            console.error("Error loading sessions.json", e);
        }
    }
    return {};
}

function saveSessions(sessions) {
    fs.writeFileSync(sessionsFile, JSON.stringify(sessions, null, 2));
}

// Lấy danh sách sessions
app.get('/api/sessions', (req, res) => {
    const sessions = loadSessions();
    res.json(Object.values(sessions).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)));
});

// Dừng một session đang chạy
app.post('/api/stop-agent', (req, res) => {
    const { sessionId } = req.body;
    const process = runningProcesses.get(sessionId);
    if (process) {
        process.kill('SIGTERM');
        runningProcesses.delete(sessionId);
        return res.json({ success: true, message: `Đã dừng session ${sessionId}` });
    }
    res.status(404).json({ error: 'Không tìm thấy session đang chạy' });
});

app.post('/api/run-agent', (req, res) => {
    let { sessionId, projectPath, projectType, taskType, instruction, referenceFiles, gitType, username, issueCode, isFollowUp, shouldCommit } = req.body;
    projectPath = expandHome(projectPath);
    
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(400).json({ error: 'Chưa cấu hình GEMINI_API_KEY trong file .env' });
    }

    // Nếu không có sessionId (lần đầu tạo), sinh ID mới
    if (!sessionId) {
        sessionId = crypto.randomUUID().substring(0, 8);
    }

    const sessions = loadSessions();
    
    // Cập nhật hoặc tạo mới thông tin session
    sessions[sessionId] = {
        id: sessionId,
        projectPath,
        projectType,
        username,
        issueCode,
        updatedAt: new Date().toISOString(),
        title: sessions[sessionId]?.title || instruction.substring(0, 50) + "..."
    };
    saveSessions(sessions);

    const globalTemplateDir = path.join(__dirname, 'templates');
    const localTemplateDir = path.join(projectPath, 'ai-centric-template');

    function getTemplateContent(fileName, defaultText = "") {
        const localPath = path.join(localTemplateDir, fileName);
        const globalPath = path.join(globalTemplateDir, fileName);
        if (fs.existsSync(localPath)) return fs.readFileSync(localPath, 'utf8');
        if (fs.existsSync(globalPath)) return fs.readFileSync(globalPath, 'utf8');
        return defaultText;
    }

    let contextRules = getTemplateContent(projectType + '.md', "# Rules for " + projectType);
    let gitRules = getTemplateContent('git-rules.md', "# Git rules template not found");
    
    const actualGitType = gitType === 'feature' ? 'feat' : 'fix';
    gitRules = gitRules.replace(/{{username}}/g, username)
                       .replace(/{{type}}/g, actualGitType)
                       .replace(/{{issue_code}}/g, issueCode);

    // Xây dựng chỉ thị commit/push linh hoạt
    const slug = instruction.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 30);
    const branchName = `${gitType}/tda/${username}/${issueCode.toLowerCase()}-${slug}`;
    const commitInstruction = shouldCommit ? `
3. THỰC HIỆN COMMIT VÀ PUSH (BẮT BUỘC):
   - Commit message phải đúng format: [${actualGitType}][${issueCode.toUpperCase()}] <Mô tả bằng tiếng Anh>
   - Sau đó chạy lệnh: git push ssh-tda ${branchName}
` : `
3. TUYỆT ĐỐI KHÔNG COMMIT, KHÔNG PUSH:
   - Bạn KHÔNG ĐƯỢC phép sử dụng tính năng auto-commit của aider.
   - Chỉ sửa file và giải thích logic. Để người dùng tự kiểm tra và commit sau.
`;

    const fullPrompt = isFollowUp ? instruction : `
[NGỮ CẢNH DỰ ÁN]:
${contextRules}

[QUY TẮC GIT VÀ PUSH CODE]:
${gitRules}

[YÊU CẦU CHI TIẾT]:
${instruction}

[CHỈ THỊ THỰC THI (BẮT BUỘC - PHẢI TUÂN THỦ)]:
1. KIỂM TRA VÀ TẠO BRANCH NGAY LẬP TỨC: 
   - Trước khi sửa bất kỳ code nào, hãy chạy lệnh shell để kiểm tra branch.
   - Nếu chưa ở branch ${branchName}, hãy chạy lệnh: git checkout -b ${branchName}
   - Nếu branch đã tồn tại, hãy switch sang: git checkout ${branchName}

2. THỰC HIỆN SỬA LỖI/TÍNH NĂNG:
   - Chỉ thực hiện sau khi chắc chắn đang ở branch ${branchName}.

${commitInstruction}
4. Phản hồi bằng TIẾNG VIỆT. Tên Branch/Commit dùng TIẾNG ANH.
`;

    // Cô lập lịch sử chat
    const chatHistoryFile = path.join(projectPath, `.aider.chat.history.${sessionId}.md`);
    const inputHistoryFile = path.join(projectPath, `.aider.input.history.${sessionId}`);

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.write(`🆔 SESSION_ID: ${sessionId}\n`);

    
    try {
        const { execSync } = require('child_process');
        res.write(`🌿 Đang chuẩn bị branch: ${branchName}...\n`);
        try {
            execSync(`git rev-parse --verify ${branchName}`, { cwd: projectPath, stdio: 'ignore' });
            execSync(`git checkout ${branchName}`, { cwd: projectPath });
            res.write(`✅ Đã chuyển sang branch: ${branchName}\n`);
        } catch (e) {
            execSync(`git checkout -b ${branchName}`, { cwd: projectPath });
            res.write(`✅ Đã tạo branch mới: ${branchName}\n`);
        }
    } catch (err) {
        res.write(`⚠️ Git: ${err.message}\n`);
    }

    res.write(`--------------------------------------------------------------------------------\n\n`);

    let aiderArgs = [
        '--model', 'gemini/gemini-2.5-flash',
        '--architect',
        '--yes', 
        '--chat-language', 'Vietnamese',
        '--map-tokens', '4096',
        '--no-check-update',
        '--cache-prompts',
        '--chat-history-file', chatHistoryFile,
        '--input-history-file', inputHistoryFile,
        '--set-env', 'GOOGLE_API_KEY=' + apiKey,
        '--message', fullPrompt
    ];

    // Cấu hình Git & Commit Message
    if (shouldCommit) {
        aiderArgs.push('--auto-commits');
        aiderArgs.push('--commit-prompt', `Sử dụng format: [${actualGitType}][${issueCode.toUpperCase()}] <Mô tả tiếng anh ngắn gọn về thay đổi>`);
    } else {
        aiderArgs.push('--no-auto-commits');
        aiderArgs.push('--no-dirty-commits');
    }

    const agentProcess = spawn(aiderCommand, aiderArgs, {
        cwd: projectPath,
        env: { 
            ...process.env, 
            GEMINI_API_KEY: apiKey,
            PYTHONIOENCODING: 'utf8',
            PATH: process.env.PATH + ':' + path.join(os.homedir(), '.local/bin')
        }
    });

    runningProcesses.set(sessionId, agentProcess);

    agentProcess.stdout.on('data', (data) => res.write(data.toString()));
    agentProcess.stderr.on('data', (data) => res.write(data.toString()));
    agentProcess.on('close', (code) => {
        runningProcesses.delete(sessionId);
        res.write(`\n\n=== HOÀN THÀNH (Mã thoát: ${code}) ===\n`);
        res.end();
    });
});

const PORT = 3002;
app.listen(PORT, () => console.log(`🤖 Multi-Session AI Agent Server: http://localhost:${PORT}`));
