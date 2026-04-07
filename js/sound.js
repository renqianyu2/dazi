// 音效工具 - 优化版（更柔和舒适的音效）
const Sound = {
    audioContext: null,
    muted: localStorage.getItem('game_muted') === 'true',

    // 获取或创建 AudioContext
    _getContext() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
        return this.audioContext;
    },

    // 切换静音状态
    toggleMute() {
        this.muted = !this.muted;
        localStorage.setItem('game_muted', this.muted);
        // 更新按钮显示（兼容不同页面的按钮）
        const btn = document.getElementById('muteBtn');
        if (btn) {
            btn.innerHTML = `音效: ${this.muted ? '关闭' : '开启'}`;
            btn.className = `mute-btn ${this.muted ? 'muted' : ''}`;
        }
        return this.muted;
    },

    // 打字正确音效 - 柔和的"嗒"声
    playCorrect() {
        if (this.muted) return;
        const ctx = this._getContext();
        const t = ctx.currentTime;

        // 使用三角波，更柔和
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1200, t);
        osc.frequency.exponentialRampToValueAtTime(600, t + 0.06);

        // 低通滤波器让声音更温暖
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(3000, t);

        // 短促柔和的包络
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.15, t + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.08);
    },

    // 打字错误音效 - 低沉的"嗡"声（不刺耳）
    playError() {
        if (this.muted) return;
        const ctx = this._getContext();
        const t = ctx.currentTime;

        // 使用正弦波而非锯齿波，更柔和
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(250, t);
        osc.frequency.linearRampToValueAtTime(180, t + 0.15);

        // 柔和的包络
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.12, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.15);
    },

    // 完成音效 - 愉快的上升琶音
    playComplete() {
        if (this.muted) return;
        const ctx = this._getContext();

        // C大调和弦音：C5, E5, G5, C6 - 更温暖的感觉
        const notes = [523.25, 659.25, 783.99, 1046.50];
        notes.forEach((freq, i) => {
            const t = ctx.currentTime + i * 0.1;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'sine';
            osc.frequency.value = freq;

            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(0.12, t + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(t);
            osc.stop(t + 0.35);
        });
    }
};
