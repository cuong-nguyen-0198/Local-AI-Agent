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
    if (pathStr.startsWith('~')) {
        return path.join(os.homedir(), pathStr.slice(1));
    }
    return pathStr;
}

const aiderCommand = '/home/cuongnguyen1/.local/bin/aider';

app.post('/api/run-agent', (req, res) => {
    let { projectPath, projectType, taskType, instruction, expectedOutput } = req.body;
    projectPath = expandHome(projectPath);
    
    const apiKey = process.env.GEMINI_API_KEY;
    const aiModel = process.env.GEMINI_MODEL ?? 'gemini/gemini-3-flash-preview';
    if (!apiKey || apiKey === '') {
        return res.status(400).json({ error: 'Chưa cấu hình GEMINI_API_KEY' });
    }

    let contextRules = '';
    const templatePath = path.join(__dirname, 'templates', projectType + '.md');
    if (fs.existsSync(templatePath)) {
        contextRules = fs.readFileSync(templatePath, 'utf8');
    }

    const fullPrompt = `
[NGỮ CẢNH DỰ ÁN]:
${contextRules}

[YÊU CẦU]:
${instruction}

[RÀNG BUỘC]:
${expectedOutput}

[LƯU Ý QUAN TRỌNG]: Hãy thực hiện các thay đổi và giải thích, phản hồi hoàn toàn bằng TIẾNG VIỆT.
`;

    let aiderArgs = [
        '--model', aiModel,
        '--yes', 
        '--chat-language', 'Vietnamese',
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

    console.log(`🚀 Task Started: ${projectPath} using ${aiderCommand}`);
    
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    const agentProcess = spawn(aiderCommand, aiderArgs, {
        cwd: projectPath,
        env: { 
            ...process.env, 
            GEMINI_API_KEY: apiKey, 
            PYTHONIOENCODING: 'utf8', 
            PATH: process.env.PATH + ':/home/cuongnguyen1/.local/bin' 
        }
    });

    agentProcess.stdout.on('data', (data) => {
        res.write(data.toString());
    });

    agentProcess.stderr.on('data', (data) => {
        res.write(data.toString());
    });

    agentProcess.on('close', (code) => {
        res.write(`

=== HOÀN THÀNH (Mã thoát: ${code}) ===
`);
        res.end();
    });
});

app.listen(3002, () => console.log('🤖 Agent Server running at http://localhost:3002'));