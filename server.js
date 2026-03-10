require('dotenv').config();
const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

function expandHome(pathStr) {
    if (!pathStr) return "";
    if (pathStr.startsWith('~')) { return path.join(os.homedir(), pathStr.slice(1)); }
    return pathStr;
}

const aiderCommand = '/home/cuongnguyen1/.local/bin/aider';

app.post('/api/run-agent', (req, res) => {
    let { projectPath, projectType, taskType, instruction, referenceFiles, gitType, username, issueCode } = req.body;
    projectPath = expandHome(projectPath);
    
    // SỬ DỤNG DUY NHẤT 1 KEY TỪ .ENV
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === '') {
        return res.status(400).json({ error: 'Chưa cấu hình GEMINI_API_KEY trong file .env' });
    }

    const maskedKey = `${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`;
    console.log(`[AUTH] Đang sử dụng Key: ${maskedKey}`);

    const localTemplateDir = path.join(projectPath, 'ai-centric-template');
    const globalTemplateDir = path.join(__dirname, 'templates');

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

    const fullPrompt = `
[NGỮ CẢNH DỰ ÁN]:
${contextRules}

[QUY TẮC GIT VÀ PUSH CODE]:
${gitRules}

[YÊU CẦU CHI TIẾT]:
${instruction}

[CHỈ THỊ THỰC THI (BẮT BUỘC)]:
1. Tạo branch: ${gitType}/tda/${username}/${issueCode.toLowerCase()}-<slug-tiếng-anh>
2. Thực hiện sửa lỗi/tính năng.
3. Nếu taskType là 'fix_code':
   - Commit: [${actualGitType}][${issueCode.toUpperCase()}] <Mô tả tiếng anh>
   - Sau đó chạy: git push ssh-tda <tên-branch-vừa-tạo>
4. Phản hồi bằng TIẾNG VIỆT. Tên Branch/Commit dùng TIẾNG ANH.
`;

    let aiderArgs = [
        '--model', 'gemini/gemini-2.5-flash',
        '--architect',
        '--yes', 
        '--chat-language', 'Vietnamese',
        '--map-tokens', '4096', // Tầm nhìn rộng cho toàn bộ dự án
        '--no-suggest-shell-commands',
        '--no-check-update',
        '--set-env', 'GOOGLE_API_KEY=' + apiKey,
        '--message', fullPrompt
    ];

    // Tự động nhận diện file từ instruction để mở sẵn cho AI
    const fileRegex = /([a-zA-Z0-9_\-\/]+\.(?:tsx|ts|js|jsx|php|go|md|txt))/g;
    let foundFiles = instruction.match(fileRegex) || [];
    let allFiles = new Set(foundFiles);
    
    if (referenceFiles) {
        referenceFiles.split(/[\n,]+/).forEach(f => { if(f.trim()) allFiles.add(f.trim()); });
    }
    
    // Đưa tất cả file liên quan vào context chỉnh sửa
    allFiles.forEach(f => {
        const fullPath = path.isAbsolute(f) ? f : path.join(projectPath, f);
        if (fs.existsSync(fullPath)) {
            aiderArgs.push(f);
        }
    });

    // Thêm các file rules/template vào context đọc
    const localProjFile = path.join(projectPath, 'ai-centric-template', projectType + '.md');
    const globalProjFile = path.join(globalTemplateDir, projectType + '.md');
    if (fs.existsSync(localProjFile)) aiderArgs.push('--read', localProjFile);
    else if (fs.existsSync(globalProjFile)) aiderArgs.push('--read', globalProjFile);

    if (taskType === 'summarize') { 
        aiderArgs.push('--no-auto-commits'); 
    } else { 
        aiderArgs.push('--auto-commits');
        if (projectType === 'go') aiderArgs.push('--test-cmd', 'go test ./...');
        if (projectType === 'php') aiderArgs.push('--test-cmd', 'php artisan test');
        if (projectType === 'javascript') aiderArgs.push('--test-cmd', 'npm test');
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    // Hiển thị Key đang dùng ra Web Terminal
    res.write(`🔑 ĐANG SỬ DỤNG KEY: ${maskedKey}\n`);
    res.write(`--------------------------------------------------------------------------------\n\n`);

    const agentProcess = spawn(aiderCommand, aiderArgs, {
        cwd: projectPath,
        env: { 
            ...process.env, 
            GEMINI_API_KEY: apiKey,
            LITELLM_LOGGING: 'debug',
            PYTHONIOENCODING: 'utf8',
            PATH: process.env.PATH + ':' + path.join(os.homedir(), '.local/bin')
        }
    });

    agentProcess.stdout.on('data', (data) => res.write(data.toString()));
    agentProcess.stderr.on('data', (data) => res.write(data.toString()));
    agentProcess.on('close', (code) => {
        res.write(`\n\n=== HOÀN THÀNH (Mã thoát: ${code}) ===\n`);
        res.end();
    });
});

const PORT = 3002;
app.listen(PORT, () => console.log(`🤖 AI Agent Server: http://localhost:${PORT}`));