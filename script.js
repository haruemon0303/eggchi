// ========================================
// グローバル変数
// ========================================
let speciesData = null;
let itemsData = null;
let gameState = null;
let audioContext = null;
let isMuted = false;
let volume = 0.5;

// ゲームループ用
let lastUpdateTime = Date.now();
let animationFrame = null;

// ミニゲーム用
let timingGameState = null;
let choiceGameState = null;

// ========================================
// 初期化
// ========================================
async function init() {
    // データロード
    await loadGameData();

    // AudioContext初期化（ユーザー操作後に行う）
    document.addEventListener('click', initAudio, { once: true });

    // ゲーム状態の初期化またはロード
    loadOrCreateGameState();

    // UI初期化
    initUI();

    // ゲームループ開始
    startGameLoop();
}

// データロード
async function loadGameData() {
    try {
        const [speciesRes, itemsRes] = await Promise.all([
            fetch('data/species.json'),
            fetch('data/items.json')
        ]);
        speciesData = await speciesRes.json();
        itemsData = await itemsRes.json();
    } catch (error) {
        console.error('Failed to load game data:', error);
        alert('ゲームデータの読み込みに失敗しました');
    }
}

// Audio初期化
function initAudio() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
}

// ========================================
// ゲーム状態管理
// ========================================
function createNewGameState() {
    return {
        // ステータス (0-100)
        hunger: 0,          // 空腹度（高いほど空腹）
        energy: 100,        // 元気
        happiness: 50,      // ごきげん
        cleanliness: 100,   // 清潔度

        // 状態フラグ
        isSick: false,
        isSleeping: false,
        dirtLevel: 0,       // 汚れの量

        // 成長関連
        age: 0,             // 年齢（分）
        stageId: 'egg',

        // ケア品質追跡
        careQuality: 100,   // 平均ケア品質
        mistakes: 0,        // ケアミス回数

        // タイムスタンプ
        lastUpdateTime: Date.now(),
        createdAt: Date.now()
    };
}

function loadOrCreateGameState() {
    const saved = localStorage.getItem('eggchi_save');
    if (saved) {
        gameState = JSON.parse(saved);
        // 不在時間を計算して状態を更新
        const now = Date.now();
        const timeDiff = now - gameState.lastUpdateTime;
        applyTimeProgression(timeDiff);
    } else {
        gameState = createNewGameState();
    }
    gameState.lastUpdateTime = Date.now();
    saveGameState();
}

function saveGameState() {
    gameState.lastUpdateTime = Date.now();
    localStorage.setItem('eggchi_save', JSON.stringify(gameState));
}

// 時間経過による状態変化
function applyTimeProgression(timeDiff) {
    // 最大48時間分まで適用（それ以上は切り捨て）
    const maxTime = 48 * 60 * 60 * 1000;
    timeDiff = Math.min(timeDiff, maxTime);

    const minutes = timeDiff / (60 * 1000);

    // 眠っている場合は進行が遅い
    const progressionRate = gameState.isSleeping ? 0.3 : 1.0;

    // 年齢を増やす
    gameState.age += minutes;

    // ステータス悪化
    gameState.hunger += minutes * 0.8 * progressionRate;
    gameState.energy -= minutes * 0.5 * progressionRate;
    gameState.happiness -= minutes * 0.3 * progressionRate;
    gameState.cleanliness -= minutes * 0.4 * progressionRate;

    // 範囲制限
    gameState.hunger = Math.max(0, Math.min(100, gameState.hunger));
    gameState.energy = Math.max(0, Math.min(100, gameState.energy));
    gameState.happiness = Math.max(0, Math.min(100, gameState.happiness));
    gameState.cleanliness = Math.max(0, Math.min(100, gameState.cleanliness));

    // 汚れレベル増加
    if (gameState.cleanliness < 30) {
        gameState.dirtLevel = Math.floor((30 - gameState.cleanliness) / 5);
    } else {
        gameState.dirtLevel = 0;
    }

    // バッドステータスチェック
    checkBadStatus();

    // 進化チェック
    checkEvolution();

    // ケア品質更新
    updateCareQuality();
}

function checkBadStatus() {
    // 病気判定
    const lowStatCount = [
        gameState.hunger > 80,
        gameState.energy < 20,
        gameState.cleanliness < 20
    ].filter(Boolean).length;

    if (lowStatCount >= 2 && Math.random() < 0.3) {
        gameState.isSick = true;
    }

    // 病気の場合、他のステータスも悪化
    if (gameState.isSick) {
        gameState.happiness = Math.max(0, gameState.happiness - 10);
        gameState.energy = Math.max(0, gameState.energy - 5);
    }
}

function updateCareQuality() {
    // ケア品質 = 各ステータスの良好度の平均
    const hungerScore = Math.max(0, 100 - gameState.hunger);
    const energyScore = gameState.energy;
    const happinessScore = gameState.happiness;
    const cleanScore = gameState.cleanliness;

    gameState.careQuality = (hungerScore + energyScore + happinessScore + cleanScore) / 4;

    // ミス回数カウント（ステータスが悪い状態が続いたら）
    if (gameState.careQuality < 30) {
        gameState.mistakes++;
    }
}

// 進化チェック
function checkEvolution() {
    const currentStage = speciesData.stages.find(s => s.id === gameState.stageId);
    if (!currentStage) return;

    // 次のステージを探す
    for (const stage of speciesData.stages) {
        if (stage.id === gameState.stageId) continue;
        if (!stage.evolutionRequirements) continue;

        const req = stage.evolutionRequirements;
        if (gameState.age >= req.minAge &&
            gameState.careQuality >= req.minCareQuality &&
            gameState.mistakes <= req.maxMistakes) {
            evolve(stage.id);
            break;
        }
    }
}

function evolve(newStageId) {
    gameState.stageId = newStageId;
    playSound('evolution');
    showEvolutionEffect();
    saveGameState();
}

function showEvolutionEffect() {
    const canvas = document.getElementById('pet-canvas');
    canvas.classList.add('evolution-effect');
    setTimeout(() => {
        canvas.classList.remove('evolution-effect');
    }, 1000);
}

// ========================================
// UI初期化とイベント
// ========================================
function initUI() {
    // メインボタン
    document.getElementById('btn-feed').addEventListener('click', () => openScreen('feed-screen'));
    document.getElementById('btn-play').addEventListener('click', () => openScreen('game-screen'));
    document.getElementById('btn-clean').addEventListener('click', doClean);
    document.getElementById('btn-menu').addEventListener('click', () => openScreen('menu-screen'));

    // 食べ物画面
    document.getElementById('btn-feed-close').addEventListener('click', () => closeScreen('feed-screen'));
    populateFoodList();

    // ゲーム画面
    document.getElementById('btn-game-close').addEventListener('click', () => closeScreen('game-screen'));
    document.querySelectorAll('.game-select-button').forEach(btn => {
        btn.addEventListener('click', (e) => startMinigame(e.target.dataset.game));
    });

    // タイミングゲーム
    document.getElementById('timing-button').addEventListener('click', timingGameClick);

    // 選択ゲーム
    document.querySelectorAll('.choice-button').forEach(btn => {
        btn.addEventListener('click', (e) => choiceGameClick(e.target.dataset.choice));
    });

    // メニュー画面
    document.getElementById('btn-menu-close').addEventListener('click', () => closeScreen('menu-screen'));
    document.getElementById('btn-medicine').addEventListener('click', useMedicine);
    document.getElementById('btn-sleep').addEventListener('click', toggleSleep);
    document.getElementById('btn-reset').addEventListener('click', resetGame);

    // 音量設定
    const volumeSlider = document.getElementById('volume-slider');
    volumeSlider.addEventListener('input', (e) => {
        volume = e.target.value / 100;
        document.getElementById('volume-value').textContent = e.target.value + '%';
    });

    const muteBtn = document.getElementById('btn-mute');
    muteBtn.addEventListener('click', () => {
        isMuted = !isMuted;
        muteBtn.textContent = 'ミュート: ' + (isMuted ? 'ON' : 'OFF');
    });

    // 初期UI更新
    updateUI();
}

function openScreen(screenId) {
    document.getElementById(screenId).classList.add('active');
    if (screenId === 'menu-screen') {
        updateMenuStatus();
    } else if (screenId === 'game-screen') {
        resetGameScreen();
    }
}

function closeScreen(screenId) {
    document.getElementById(screenId).classList.remove('active');
}

function resetGameScreen() {
    document.getElementById('game-select').style.display = 'flex';
    document.getElementById('timing-game').classList.add('hidden');
    document.getElementById('choice-game').classList.add('hidden');
}

// ========================================
// アクション
// ========================================
function populateFoodList() {
    const foodList = document.getElementById('food-list');
    foodList.innerHTML = '';

    itemsData.foods.forEach(food => {
        const btn = document.createElement('button');
        btn.className = 'item-button';
        btn.innerHTML = `
            <div class="item-name">${food.name}</div>
            <div class="item-description">${food.description}</div>
        `;
        btn.addEventListener('click', () => feedPet(food));
        foodList.appendChild(btn);
    });
}

function feedPet(food) {
    gameState.hunger = Math.max(0, gameState.hunger + food.effects.hunger);
    gameState.happiness = Math.min(100, gameState.happiness + food.effects.happiness);
    gameState.energy = Math.min(100, gameState.energy + food.effects.energy);

    playSound('feed');
    closeScreen('feed-screen');
    saveGameState();
    updateUI();
}

function doClean() {
    if (gameState.cleanliness < 100) {
        gameState.cleanliness = 100;
        gameState.dirtLevel = 0;
        playSound('clean');
        updateDirtDisplay();
        saveGameState();
        updateUI();
    }
}

function useMedicine() {
    if (gameState.isSick) {
        gameState.isSick = false;
        gameState.energy = Math.min(100, gameState.energy + 50);
        playSound('heal');
        saveGameState();
        updateUI();
    } else {
        alert('病気ではありません');
    }
}

function toggleSleep() {
    gameState.isSleeping = !gameState.isSleeping;
    playSound('sleep');
    saveGameState();
    updateUI();
}

function resetGame() {
    if (confirm('本当にリセットしますか？すべてのデータが削除されます。')) {
        localStorage.removeItem('eggchi_save');
        location.reload();
    }
}

// ========================================
// ミニゲーム
// ========================================
function startMinigame(gameType) {
    document.getElementById('game-select').style.display = 'none';

    if (gameType === 'timing') {
        document.getElementById('timing-game').classList.remove('hidden');
        initTimingGame();
    } else if (gameType === 'choice') {
        document.getElementById('choice-game').classList.remove('hidden');
        initChoiceGame();
    }
}

// タイミングゲーム
function initTimingGame() {
    const canvas = document.getElementById('timing-canvas');
    const ctx = canvas.getContext('2d');

    timingGameState = {
        position: 0,
        direction: 1,
        speed: 2,
        active: true,
        ctx: ctx,
        canvas: canvas
    };

    document.getElementById('timing-result').textContent = '';
    animateTimingGame();
}

function animateTimingGame() {
    if (!timingGameState || !timingGameState.active) return;

    const { ctx, canvas, speed, direction } = timingGameState;

    // 位置更新
    timingGameState.position += speed * direction;
    if (timingGameState.position >= canvas.width - 20 || timingGameState.position <= 0) {
        timingGameState.direction *= -1;
    }

    // 描画
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // ターゲットゾーン
    ctx.fillStyle = '#4ade80';
    ctx.fillRect(canvas.width / 2 - 25, 10, 50, 80);

    // 移動するバー
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(timingGameState.position, 30, 20, 40);

    requestAnimationFrame(animateTimingGame);
}

function timingGameClick() {
    if (!timingGameState || !timingGameState.active) return;

    const { canvas, position } = timingGameState;
    const center = canvas.width / 2;
    const distance = Math.abs(position + 10 - center);

    let result = '';
    let happinessGain = 0;

    if (distance < 15) {
        result = '🎉 パーフェクト！';
        happinessGain = 20;
    } else if (distance < 30) {
        result = '😊 いいかんじ！';
        happinessGain = 15;
    } else {
        result = '😅 ざんねん...';
        happinessGain = 5;
    }

    gameState.happiness = Math.min(100, gameState.happiness + happinessGain);
    gameState.energy = Math.max(0, gameState.energy - 10);

    document.getElementById('timing-result').textContent = result;
    timingGameState.active = false;

    playSound('game');
    saveGameState();
    updateUI();

    setTimeout(() => {
        closeScreen('game-screen');
    }, 2000);
}

// 選択ゲーム
function initChoiceGame() {
    choiceGameState = {
        answer: Math.random() < 0.5 ? 'left' : 'right',
        active: true
    };

    document.getElementById('choice-result').textContent = '';
}

function choiceGameClick(choice) {
    if (!choiceGameState || !choiceGameState.active) return;

    choiceGameState.active = false;

    let result = '';
    let happinessGain = 0;

    if (choice === choiceGameState.answer) {
        result = '🎉 せいかい！';
        happinessGain = 20;
    } else {
        result = '😅 はずれ...';
        happinessGain = 5;
    }

    gameState.happiness = Math.min(100, gameState.happiness + happinessGain);
    gameState.energy = Math.max(0, gameState.energy - 10);

    document.getElementById('choice-result').textContent = result;

    playSound('game');
    saveGameState();
    updateUI();

    setTimeout(() => {
        closeScreen('game-screen');
    }, 2000);
}

// ========================================
// UI更新
// ========================================
function updateUI() {
    // 時刻表示
    const now = new Date();
    document.getElementById('time-display').textContent =
        String(now.getHours()).padStart(2, '0') + ':' +
        String(now.getMinutes()).padStart(2, '0');

    // ステータスアイコン
    updateStatusIcon('icon-hunger', gameState.hunger > 60);
    updateStatusIcon('icon-energy', gameState.energy < 30);
    updateStatusIcon('icon-happiness', gameState.happiness < 30);
    updateStatusIcon('icon-cleanliness', gameState.cleanliness < 30);
    updateStatusIcon('icon-sick', gameState.isSick, true);
    updateStatusIcon('icon-sleep', gameState.isSleeping, true);

    // ペット名と年齢
    const stage = speciesData.stages.find(s => s.id === gameState.stageId);
    if (stage) {
        document.getElementById('pet-name').textContent = stage.name;
    }
    document.getElementById('pet-age').textContent = `年齢: ${Math.floor(gameState.age)}分`;

    // 汚れ表示
    updateDirtDisplay();

    // ペット描画
    drawPet();
}

function updateStatusIcon(iconId, isActive, alwaysShow = false) {
    const icon = document.getElementById(iconId);
    if (alwaysShow) {
        icon.classList.toggle('hidden', !isActive);
    }
    icon.classList.toggle('active', isActive);
}

function updateDirtDisplay() {
    const container = document.getElementById('dirt-container');
    container.innerHTML = '';

    for (let i = 0; i < gameState.dirtLevel; i++) {
        const dirt = document.createElement('div');
        dirt.className = 'dirt';
        dirt.textContent = '💩';
        dirt.style.left = (20 + i * 60) + 'px';
        dirt.style.bottom = (10 + Math.random() * 40) + 'px';
        container.appendChild(dirt);
    }
}

function updateMenuStatus() {
    const stage = speciesData.stages.find(s => s.id === gameState.stageId);

    // ステータス値
    document.getElementById('val-hunger').textContent = Math.floor(gameState.hunger);
    document.getElementById('val-energy').textContent = Math.floor(gameState.energy);
    document.getElementById('val-happiness').textContent = Math.floor(gameState.happiness);
    document.getElementById('val-cleanliness').textContent = Math.floor(gameState.cleanliness);
    document.getElementById('val-age-detail').textContent = Math.floor(gameState.age) + '分';
    document.getElementById('val-stage').textContent = stage ? stage.name : '不明';
    document.getElementById('val-mistakes').textContent = gameState.mistakes + '回';

    // メーター
    document.getElementById('meter-hunger').style.width = (100 - gameState.hunger) + '%';
    document.getElementById('meter-energy').style.width = gameState.energy + '%';
    document.getElementById('meter-happiness').style.width = gameState.happiness + '%';
    document.getElementById('meter-cleanliness').style.width = gameState.cleanliness + '%';
}

// ========================================
// ペット描画（Canvas）
// ========================================
function drawPet() {
    const canvas = document.getElementById('pet-canvas');
    const ctx = canvas.getContext('2d');
    const stage = speciesData.stages.find(s => s.id === gameState.stageId);

    if (!stage) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const appearance = stage.appearance;

    // アニメーション（簡易的な揺れ）
    const time = Date.now() / 1000;
    const wobble = Math.sin(time * 2) * 3;

    // 体の描画
    ctx.fillStyle = appearance.color;

    if (appearance.shape === 'oval') {
        // 卵
        ctx.beginPath();
        ctx.ellipse(centerX, centerY, appearance.size * 0.6, appearance.size * 0.8, 0, 0, Math.PI * 2);
        ctx.fill();

        // 模様（スポット）
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.beginPath();
        ctx.arc(centerX - 15, centerY - 10, 8, 0, Math.PI * 2);
        ctx.arc(centerX + 10, centerY + 5, 6, 0, Math.PI * 2);
        ctx.fill();

    } else if (appearance.shape === 'round') {
        // 幼体（丸い）
        ctx.save();
        ctx.translate(centerX, centerY + wobble);

        // 体
        ctx.beginPath();
        ctx.arc(0, 0, appearance.size * 0.7, 0, Math.PI * 2);
        ctx.fill();

        // 模様（ストライプ）
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 4;
        for (let i = -2; i <= 2; i++) {
            ctx.beginPath();
            ctx.moveTo(-appearance.size * 0.5, i * 10);
            ctx.lineTo(appearance.size * 0.5, i * 10);
            ctx.stroke();
        }

        // 目
        if (appearance.eyes) {
            ctx.fillStyle = '#000';
            ctx.beginPath();
            ctx.arc(-12, -8, 4, 0, Math.PI * 2);
            ctx.arc(12, -8, 4, 0, Math.PI * 2);
            ctx.fill();
        }

        // 手足
        if (appearance.limbs) {
            ctx.fillStyle = appearance.color;
            ctx.fillRect(-appearance.size * 0.8, appearance.size * 0.4, 10, 15);
            ctx.fillRect(appearance.size * 0.8 - 10, appearance.size * 0.4, 10, 15);
        }

        ctx.restore();

    } else if (appearance.shape === 'upright') {
        // 成体（直立）
        ctx.save();
        ctx.translate(centerX, centerY + wobble);

        // 体
        ctx.fillStyle = appearance.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, appearance.size * 0.5, appearance.size * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();

        // 頭
        ctx.beginPath();
        ctx.arc(0, -appearance.size * 0.6, appearance.size * 0.4, 0, Math.PI * 2);
        ctx.fill();

        // 模様
        if (appearance.pattern === 'hearts') {
            ctx.fillStyle = 'rgba(255, 192, 203, 0.6)';
            // ハート（簡易）
            ctx.beginPath();
            ctx.arc(-8, 0, 6, 0, Math.PI * 2);
            ctx.arc(8, 0, 6, 0, Math.PI * 2);
            ctx.fill();
        }

        // 目
        if (appearance.eyes) {
            ctx.fillStyle = '#000';
            ctx.beginPath();
            ctx.arc(-10, -appearance.size * 0.6, 4, 0, Math.PI * 2);
            ctx.arc(10, -appearance.size * 0.6, 4, 0, Math.PI * 2);
            ctx.fill();

            // 表情
            if (gameState.isSick) {
                ctx.strokeStyle = '#000';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(0, -appearance.size * 0.4, 8, 0.2, Math.PI - 0.2);
                ctx.stroke();
            } else if (gameState.happiness > 60) {
                ctx.beginPath();
                ctx.arc(0, -appearance.size * 0.45, 8, 0.2, Math.PI - 0.2, true);
                ctx.stroke();
            }
        }

        // 手足
        if (appearance.limbs >= 2) {
            ctx.fillStyle = appearance.color;
            ctx.fillRect(-appearance.size * 0.6, appearance.size * 0.4, 12, 20);
            ctx.fillRect(appearance.size * 0.6 - 12, appearance.size * 0.4, 12, 20);
        }

        // 翼
        if (appearance.wings) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.beginPath();
            ctx.ellipse(-appearance.size * 0.6, 0, 15, 25, -0.3, 0, Math.PI * 2);
            ctx.ellipse(appearance.size * 0.6, 0, 15, 25, 0.3, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();

    } else if (appearance.shape === 'squat') {
        // 不機嫌な成体（ずんぐり）
        ctx.save();
        ctx.translate(centerX, centerY + wobble);

        ctx.fillStyle = appearance.color;
        ctx.fillRect(-appearance.size * 0.5, -appearance.size * 0.3, appearance.size, appearance.size * 0.8);

        // 目
        if (appearance.eyes) {
            ctx.fillStyle = '#000';
            ctx.beginPath();
            ctx.arc(-15, -10, 3, 0, Math.PI * 2);
            ctx.arc(15, -10, 3, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }

    // 睡眠中の表示
    if (gameState.isSleeping) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.font = '30px serif';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText('💤', centerX + 30, centerY - 30);
    }
}

// ========================================
// 効果音（WebAudio）
// ========================================
function playSound(type) {
    if (isMuted || !audioContext) return;

    const ctx = audioContext;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    gain.gain.value = volume * 0.1;

    switch(type) {
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
            osc.stop(ctx.currentTime + 0.15);
            break;
        case 'game':
            osc.frequency.value = 800;
            osc.type = 'triangle';
            osc.start();
            osc.stop(ctx.currentTime + 0.2);
            break;
        case 'evolution':
            // 上昇音
            osc.frequency.setValueAtTime(200, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.5);
            osc.type = 'sawtooth';
            osc.start();
            osc.stop(ctx.currentTime + 0.5);
            break;
        case 'heal':
            osc.frequency.value = 523;
            osc.type = 'sine';
            osc.start();
            osc.stop(ctx.currentTime + 0.3);
            break;
        case 'sleep':
            osc.frequency.value = 300;
            osc.type = 'sine';
            gain.gain.setValueAtTime(volume * 0.1, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
            osc.start();
            osc.stop(ctx.currentTime + 0.5);
            break;
    }
}

// ========================================
// ゲームループ
// ========================================
function startGameLoop() {
    function loop() {
        const now = Date.now();
        const delta = now - lastUpdateTime;

        // 1秒ごとに更新
        if (delta >= 1000) {
            applyTimeProgression(delta);
            updateUI();
            lastUpdateTime = now;
        }

        animationFrame = requestAnimationFrame(loop);
    }

    loop();
}

// ========================================
// 起動
// ========================================
window.addEventListener('DOMContentLoaded', init);
