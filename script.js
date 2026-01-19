// ========================================
// グローバル変数
// ========================================
let speciesData = null;
let itemsData = null;
let gameState = null;
let audioContext = null;
let isMuted = false;
let volume = 0.5;

// ゲームループ
let lastTickTime = Date.now();
let animationTime = 0;

// ミニゲーム状態
let miniGameActive = false;
let gameBarPosition = 0;
let gameBarDirection = 1;

// ========================================
// 初期化
// ========================================
async function init() {
    await loadData();
    setupAudio();
    loadOrCreateGameState();
    setupUI();
    startGameLoop();
}

async function loadData() {
    try {
        const [speciesRes, itemsRes] = await Promise.all([
            fetch('data/species.json'),
            fetch('data/items.json')
        ]);
        speciesData = await speciesRes.json();
        itemsData = await itemsRes.json();
    } catch (error) {
        console.error('Failed to load data:', error);
        alert('データ読み込みエラー');
    }
}

function setupAudio() {
    document.addEventListener('click', () => {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
    }, { once: true });
}

// ========================================
// ゲーム状態
// ========================================
function createNewGameState() {
    return {
        // ステータス (0-100)
        hunger: 0,
        energy: 100,
        mood: 50,
        cleanliness: 100,
        affection: 50,

        // 状態フラグ
        isSick: false,

        // 成長
        age: 0,
        stageId: 'egg',

        // ケア傾向カウント
        feedCount: 0,
        playCount: 0,
        cleanCount: 0,
        neglectTime: 0,

        // タイムスタンプ
        lastUpdateTime: Date.now(),
        createdAt: Date.now()
    };
}

function loadOrCreateGameState() {
    const saved = localStorage.getItem('mirumono_save');
    if (saved) {
        gameState = JSON.parse(saved);
        applyTimeProgression(Date.now() - gameState.lastUpdateTime);
    } else {
        gameState = createNewGameState();
    }
    gameState.lastUpdateTime = Date.now();
    saveGameState();
}

function saveGameState() {
    gameState.lastUpdateTime = Date.now();
    localStorage.setItem('mirumono_save', JSON.stringify(gameState));
}

function applyTimeProgression(timeDiff) {
    // 最大24時間まで
    timeDiff = Math.min(timeDiff, 24 * 60 * 60 * 1000);

    const minutes = timeDiff / (60 * 1000);

    // 年齢増加
    gameState.age += minutes;

    // ステータス変化（5分で以下の変化）
    const rate = minutes / 5;
    gameState.hunger += 6 * rate;
    gameState.energy -= 4 * rate;
    gameState.mood -= 2 * rate;
    gameState.cleanliness -= 3 * rate;
    gameState.affection -= 1 * rate;

    // 放置時間カウント
    if (minutes > 10) {
        gameState.neglectTime += minutes;
    }

    // 範囲制限
    gameState.hunger = clamp(gameState.hunger, 0, 100);
    gameState.energy = clamp(gameState.energy, 0, 100);
    gameState.mood = clamp(gameState.mood, 0, 100);
    gameState.cleanliness = clamp(gameState.cleanliness, 0, 100);
    gameState.affection = clamp(gameState.affection, 0, 100);

    // 体調不良チェック
    checkSickness();

    // 進化チェック
    checkEvolution();
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function checkSickness() {
    const badCount = [
        gameState.hunger > 80,
        gameState.energy < 20,
        gameState.cleanliness < 20
    ].filter(Boolean).length;

    if (badCount >= 2 && Math.random() < 0.3) {
        gameState.isSick = true;
    }
}

function checkEvolution() {
    const currentStage = speciesData.stages.find(s => s.id === gameState.stageId);
    if (!currentStage) return;

    // 年齢で自動進化
    if (gameState.stageId === 'egg' && gameState.age >= 5) {
        evolve('child');
    } else if (gameState.stageId === 'child' && gameState.age >= 30) {
        // ケア傾向で分岐
        const careType = determineCareType();
        const nextStage = speciesData.stages.find(s =>
            s.evolutionRequirements && s.evolutionRequirements.careType === careType
        );
        if (nextStage) {
            evolve(nextStage.id);
        }
    }
}

function determineCareType() {
    const counts = {
        feed: gameState.feedCount,
        play: gameState.playCount,
        clean: gameState.cleanCount,
        neglect: gameState.neglectTime / 60, // 分→時間
        balanced: Math.min(gameState.feedCount, gameState.playCount, gameState.cleanCount)
    };

    // 最も多い傾向を選択
    let maxType = 'balanced';
    let maxValue = counts.balanced;

    for (const [type, value] of Object.entries(counts)) {
        if (value > maxValue) {
            maxValue = value;
            maxType = type;
        }
    }

    return maxType;
}

function evolve(newStageId) {
    gameState.stageId = newStageId;
    const stage = speciesData.stages.find(s => s.id === newStageId);

    playSound('evolution');
    showMessage(`進化した！ ${stage.name}になった`);

    const canvas = document.getElementById('pet-canvas');
    canvas.classList.add('evolution-effect');
    setTimeout(() => {
        canvas.classList.remove('evolution-effect');
    }, 1200);

    saveGameState();
}

// ========================================
// UI セットアップ
// ========================================
function setupUI() {
    // メインボタン
    document.getElementById('btn-feed').addEventListener('click', () => openModal('modal-feed'));
    document.getElementById('btn-play').addEventListener('click', () => openModal('modal-game'));
    document.getElementById('btn-clean').addEventListener('click', doClean);
    document.getElementById('btn-menu').addEventListener('click', () => openModal('modal-menu'));

    // 食べ物リスト
    populateFoodList();

    // ミニゲーム
    document.getElementById('game-tap-btn').addEventListener('click', onGameTap);

    // メニュー
    document.getElementById('btn-medicine').addEventListener('click', useMedicine);
    document.getElementById('btn-reset').addEventListener('click', resetGame);
    document.getElementById('btn-mute').addEventListener('click', toggleMute);

    document.getElementById('volume').addEventListener('input', (e) => {
        volume = e.target.value / 100;
        document.getElementById('volume-text').textContent = e.target.value + '%';
    });

    // モーダルクローズ
    document.querySelectorAll('.close-btn').forEach(btn => {
        btn.addEventListener('click', closeAllModals);
    });

    updateUI();
}

function openModal(modalId) {
    document.getElementById(modalId).classList.add('active');
    if (modalId === 'modal-game') {
        startMiniGame();
    } else if (modalId === 'modal-menu') {
        updateMenuUI();
    }
}

function closeAllModals() {
    document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
    miniGameActive = false;
}

function populateFoodList() {
    const list = document.getElementById('food-list');
    list.innerHTML = '';

    itemsData.foods.forEach(food => {
        const btn = document.createElement('button');
        btn.className = 'item-btn';
        btn.innerHTML = `
            <div class="item-name">${food.name}</div>
            <div class="item-desc">${food.description}</div>
        `;
        btn.addEventListener('click', () => feedPet(food));
        list.appendChild(btn);
    });
}

// ========================================
// アクション
// ========================================
function feedPet(food) {
    gameState.hunger = clamp(gameState.hunger + food.effects.hunger, 0, 100);
    if (food.effects.mood) gameState.mood = clamp(gameState.mood + food.effects.mood, 0, 100);
    if (food.effects.affection) gameState.affection = clamp(gameState.affection + food.effects.affection, 0, 100);
    if (food.effects.energy) gameState.energy = clamp(gameState.energy + food.effects.energy, 0, 100);

    gameState.feedCount++;

    playSound('feed');
    showMessage(`${food.name}をあげた`);
    closeAllModals();
    saveGameState();
    updateUI();
}

function doClean() {
    if (gameState.cleanliness < 100) {
        gameState.cleanliness = 100;
        gameState.energy = clamp(gameState.energy + 5, 0, 100);
        gameState.cleanCount++;

        playSound('clean');
        showMessage('きれいになった');
        saveGameState();
        updateUI();
    }
}

function useMedicine() {
    if (gameState.isSick) {
        gameState.isSick = false;
        gameState.energy = clamp(gameState.energy + 30, 0, 100);

        playSound('heal');
        showMessage('体調が回復した');
        saveGameState();
        updateUI();
    } else {
        showMessage('体調は問題ない');
    }
}

function toggleMute() {
    isMuted = !isMuted;
    document.getElementById('btn-mute').textContent = 'ミュート: ' + (isMuted ? 'ON' : 'OFF');
}

function resetGame() {
    if (confirm('本当にリセットしますか？')) {
        localStorage.removeItem('mirumono_save');
        location.reload();
    }
}

// ========================================
// ミニゲーム
// ========================================
function startMiniGame() {
    miniGameActive = true;
    gameBarPosition = 0;
    gameBarDirection = 1;
    document.getElementById('game-result').textContent = '';
    animateMiniGame();
}

function animateMiniGame() {
    if (!miniGameActive) return;

    const canvas = document.getElementById('game-canvas');
    const ctx = canvas.getContext('2d');
    const speed = 3;

    gameBarPosition += speed * gameBarDirection;
    if (gameBarPosition >= canvas.width - 20 || gameBarPosition <= 0) {
        gameBarDirection *= -1;
    }

    // 描画
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // ターゲットゾーン
    ctx.fillStyle = '#6a9a5a';
    ctx.fillRect(canvas.width / 2 - 20, 20, 40, 60);

    // 移動バー
    ctx.fillStyle = '#8a3a3a';
    ctx.fillRect(gameBarPosition, 35, 20, 30);

    requestAnimationFrame(animateMiniGame);
}

function onGameTap() {
    if (!miniGameActive) return;

    miniGameActive = false;

    const canvas = document.getElementById('game-canvas');
    const center = canvas.width / 2;
    const distance = Math.abs((gameBarPosition + 10) - center);

    let result = '';
    let moodGain = 0;

    if (distance < 12) {
        result = '🎉 すごい！';
        moodGain = 20;
    } else if (distance < 25) {
        result = '😊 いいね！';
        moodGain = 12;
    } else {
        result = '😅 おしい';
        moodGain = 5;
    }

    gameState.mood = clamp(gameState.mood + moodGain, 0, 100);
    gameState.energy = clamp(gameState.energy - 8, 0, 100);
    gameState.playCount++;

    document.getElementById('game-result').textContent = result;
    playSound('game');
    saveGameState();
    updateUI();

    setTimeout(closeAllModals, 1500);
}

// ========================================
// UI更新
// ========================================
function updateUI() {
    // ステータスアイコン
    updateIcon('icon-hunger', gameState.hunger > 60);
    updateIcon('icon-energy', gameState.energy < 30);
    updateIcon('icon-mood', gameState.mood < 30);
    updateIcon('icon-clean', gameState.cleanliness < 30);
    updateIcon('icon-sick', gameState.isSick);

    // ペット情報
    const stage = speciesData.stages.find(s => s.id === gameState.stageId);
    if (stage) {
        document.getElementById('pet-name').textContent = stage.name;
    }
    document.getElementById('pet-info').textContent = `年齢: ${Math.floor(gameState.age)}分`;

    // ペット描画
    drawPet();
}

function updateIcon(id, active) {
    const icon = document.getElementById(id);
    if (active) {
        icon.classList.remove('hidden');
        icon.classList.add('active');
    } else {
        icon.classList.add('hidden');
        icon.classList.remove('active');
    }
}

function updateMenuUI() {
    const stage = speciesData.stages.find(s => s.id === gameState.stageId);

    // ステータス値
    document.getElementById('val-hunger').textContent = Math.floor(gameState.hunger);
    document.getElementById('val-energy').textContent = Math.floor(gameState.energy);
    document.getElementById('val-mood').textContent = Math.floor(gameState.mood);
    document.getElementById('val-clean').textContent = Math.floor(gameState.cleanliness);
    document.getElementById('val-affection').textContent = Math.floor(gameState.affection);

    // バー
    document.getElementById('bar-hunger').style.width = (100 - gameState.hunger) + '%';
    document.getElementById('bar-energy').style.width = gameState.energy + '%';
    document.getElementById('bar-mood').style.width = gameState.mood + '%';
    document.getElementById('bar-clean').style.width = gameState.cleanliness + '%';
    document.getElementById('bar-affection').style.width = gameState.affection + '%';

    // 情報
    document.getElementById('menu-name').textContent = stage ? stage.name : '-';
    document.getElementById('menu-age').textContent = Math.floor(gameState.age);
    document.getElementById('menu-care').textContent = determineCareType();
}

function showMessage(text) {
    const area = document.getElementById('message-area');
    area.textContent = text;
    setTimeout(() => {
        area.textContent = '';
    }, 3000);
}

// ========================================
// ペット描画
// ========================================
function drawPet() {
    const canvas = document.getElementById('pet-canvas');
    const ctx = canvas.getContext('2d');
    const stage = speciesData.stages.find(s => s.id === gameState.stageId);

    if (!stage) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const app = stage.appearance;

    // アニメーション用の揺れ
    const wobble = Math.sin(animationTime * 0.002) * 3;

    ctx.save();
    ctx.translate(centerX, centerY + wobble);

    // 影
    if (app.shadowLength) {
        ctx.fillStyle = 'rgba(0, 0, 0, ' + (app.opacity * 0.3) + ')';
        ctx.beginPath();
        ctx.ellipse(0, app.size * 0.8, app.size * 0.6, app.shadowLength * 0.3, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    // 本体
    ctx.globalAlpha = app.opacity;
    ctx.fillStyle = app.baseColor;

    if (app.type === 'shadow_sphere') {
        // カゲダマ
        const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, app.size);
        gradient.addColorStop(0, app.glowColor);
        gradient.addColorStop(1, app.baseColor);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(0, 0, app.size, 0, Math.PI * 2);
        ctx.fill();

    } else if (app.eyeCount > 0) {
        // 体
        ctx.beginPath();
        ctx.arc(0, 0, app.size * 0.7, 0, Math.PI * 2);
        ctx.fill();

        // 光のオーラ
        if (app.particles) {
            ctx.globalAlpha = 0.5;
            ctx.fillStyle = app.glowColor;
            for (let i = 0; i < 8; i++) {
                const angle = (i / 8) * Math.PI * 2 + animationTime * 0.001;
                const dist = app.size * 0.9;
                const x = Math.cos(angle) * dist;
                const y = Math.sin(angle) * dist;
                ctx.beginPath();
                ctx.arc(x, y, 3, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = app.opacity;
        }

        // 目
        ctx.fillStyle = '#000';
        if (app.eyeCount === 1) {
            ctx.beginPath();
            ctx.arc(0, -5, 8, 0, Math.PI * 2);
            ctx.fill();
        } else if (app.eyeCount === 2) {
            ctx.beginPath();
            ctx.arc(-12, -10, 6, 0, Math.PI * 2);
            ctx.arc(12, -10, 6, 0, Math.PI * 2);
            ctx.fill();
        } else if (app.eyeCount === 4) {
            // 4つの目
            ctx.beginPath();
            ctx.arc(-15, -12, 5, 0, Math.PI * 2);
            ctx.arc(15, -12, 5, 0, Math.PI * 2);
            ctx.arc(-8, 8, 4, 0, Math.PI * 2);
            ctx.arc(8, 8, 4, 0, Math.PI * 2);
            ctx.fill();
        }

        // 表情（病気時）
        if (gameState.isSick) {
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 15, 10, 0.1, Math.PI - 0.1);
            ctx.stroke();
        } else if (gameState.mood > 70) {
            ctx.beginPath();
            ctx.arc(0, 12, 10, 0.1, Math.PI - 0.1, true);
            ctx.stroke();
        }
    }

    ctx.restore();
}

// ========================================
// 効果音
// ========================================
function playSound(type) {
    if (isMuted || !audioContext) return;

    const ctx = audioContext;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.value = volume * 0.08;

    switch (type) {
        case 'feed':
            osc.frequency.value = 440;
            osc.type = 'sine';
            osc.start();
            osc.stop(ctx.currentTime + 0.1);
            break;
        case 'clean':
            osc.frequency.value = 600;
            osc.type = 'square';
            osc.start();
            osc.stop(ctx.currentTime + 0.12);
            break;
        case 'game':
            osc.frequency.value = 800;
            osc.type = 'triangle';
            osc.start();
            osc.stop(ctx.currentTime + 0.15);
            break;
        case 'evolution':
            osc.frequency.setValueAtTime(200, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(1000, ctx.currentTime + 0.5);
            osc.type = 'sawtooth';
            osc.start();
            osc.stop(ctx.currentTime + 0.5);
            break;
        case 'heal':
            osc.frequency.value = 523;
            osc.type = 'sine';
            osc.start();
            osc.stop(ctx.currentTime + 0.25);
            break;
    }
}

// ========================================
// ゲームループ
// ========================================
function startGameLoop() {
    function loop() {
        const now = Date.now();
        animationTime = now;

        // 1秒ごとに状態更新
        if (now - lastTickTime >= 1000) {
            applyTimeProgression(now - lastTickTime);
            updateUI();
            lastTickTime = now;
        }

        // 描画は常に更新（アニメーション用）
        drawPet();

        requestAnimationFrame(loop);
    }
    loop();
}

// ========================================
// 起動
// ========================================
window.addEventListener('DOMContentLoaded', init);
