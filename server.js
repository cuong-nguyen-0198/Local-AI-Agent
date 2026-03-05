require('dotenv').config();
const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.post('/api/run-agent', (req, res) => {
    const { projectPath, projectType, taskType, instruction, expectedOutput } = req.body;
    
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'nhap_api_key_cua_ban_vao_day') {
        return res.status(400).json({ error: "Chưa cấu hình GEMINI_API_KEY trong file .env" });
    }

    // 1. Đọc Context Template
    let contextRules = "";
    const templatePath = path.join(__dirname, 'templates', `${projectType}.md`);
    if (fs.existsSync(templatePath)) {
        contextRules = fs.readFileSync(templatePath, 'utf8');
    }

    // 2. Build Prompt
    const fullPrompt = `
[NGỮ CẢNH DỰ ÁN]:
${contextRules}

[YÊU CẦU / INSTRUCTION]:
${instruction}

[ĐẦU RA MONG MUỐN / CONSTRAINTS]:
${expectedOutput}
`;

    // 3. Cấu hình Aider
    let aiderArgs = [
        '--model', 'gemini/gemini-1.5-pro',
        '--yes', 
        '--message', fullPrompt
    ];

    if (taskType === 'summarize') {
        aiderArgs.push('--no-auto-commits');
    } else {
        aiderArgs.push('--auto-commits');
        if (projectType === 'go') aiderArgs.push('--test-cmd', 'go test ./...');
        if (projectType === 'php') aiderArgs.push('--test-cmd', 'php artisan test');
        if (projectType === 'javascript') aiderArgs.push('--test-cmd', 'npm test');
    }

    console.log(`🚀 Task Started: ${projectPath}`);
    
    // Set headers for streaming
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    const agentProcess = spawn('aider', aiderArgs, {
        cwd: projectPath,
        env: { ...process.env, GEMINI_API_KEY: apiKey, PYTHONIOENCODING: 'utf8' }
    });

    agentProcess.stdout.on('data', (data) => {
        res.write(data.toString());
    });

    agentProcess.stderr.on('data', (data) => {
        res.write(`[INFO/ERROR]: ${data.toString()}`);
    });

    agentProcess.on('close', (code) => {
        res.write(`\n\n=== HOÀN THÀNH (Exit Code: ${code}) ===\n`);
        res.end();
    });
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
    console.log(`🤖 Agent Server: http://localhost:${PORT}`);
});