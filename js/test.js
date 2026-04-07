// 打字测试核心逻辑
class TypingTest {
  constructor(textData, onUpdate, onComplete) {
    this.text = textData.text.content;
    this.textId = textData.text.id;
    this.pinyinHints = textData.pinyinHints;
    this.onUpdate = onUpdate;
    this.onComplete = onComplete;

    this.currentIndex = 0;
    this.correctCount = 0;
    this.errorCount = 0;
    this.consecutiveErrors = 0;
    this.startTime = null;
    this.timerInterval = null;
    this.timeLeft = 60;
    this.isRunning = false;
  }

  start() {
    this.startTime = Date.now();
    this.isRunning = true;
    this.startTimer();
  }

  startTimer() {
    this.timerInterval = setInterval(() => {
      this.timeLeft--;
      this.onUpdate(this.getStats());

      if (this.timeLeft <= 0) {
        this.end(true);
      }
    }, 1000);
  }

  isPunctuation(char) {
    const punctuation = '，。！？、；：""''（）《》【】…—·,.!?;:\'"()[]- ';
    return punctuation.includes(char);
  }

  skipPunctuation() {
    while (this.currentIndex < this.text.length && this.isPunctuation(this.text[this.currentIndex])) {
      this.correctCount++;
      this.currentIndex++;
    }
  }

  validateInput(input) {
    if (!this.isRunning) return false;

    this.skipPunctuation();

    if (this.currentIndex >= this.text.length) {
      this.end(true);
      return true;
    }

    const currentChar = this.text[this.currentIndex];

    if (input === currentChar) {
      this.correctCount++;
      this.currentIndex++;
      this.consecutiveErrors = 0;

      this.skipPunctuation();

      if (this.currentIndex >= this.text.length) {
        this.end(true);
      }
      return true;
    } else {
      this.errorCount++;
      this.consecutiveErrors++;
      this.checkConsecutiveErrors();
      return false;
    }
  }

  checkConsecutiveErrors() {
    if (this.consecutiveErrors >= 5) {
      this.end(false);
    }
  }

  getStats() {
    const elapsed = this.startTime ? (Date.now() - this.startTime) / 1000 : 0;
    const speed = elapsed > 0 ? Math.round((this.correctCount / elapsed) * 60) : 0;
    const totalAttempts = this.correctCount + this.errorCount;
    const accuracy = totalAttempts > 0 ? Math.round((this.correctCount / totalAttempts) * 100) : 100;

    return {
      speed,
      accuracy,
      timeLeft: this.timeLeft,
      currentIndex: this.currentIndex,
      correctCount: this.correctCount,
      errorCount: this.errorCount,
      consecutiveErrors: this.consecutiveErrors
    };
  }

  end(isValid) {
    if (!this.isRunning) return;

    this.isRunning = false;
    clearInterval(this.timerInterval);

    const stats = this.getStats();
    const elapsed = (Date.now() - this.startTime) / 1000;

    // 判断成绩是否有效
    const valid = isValid &&
                  elapsed >= 50 &&
                  this.consecutiveErrors < 5 &&
                  stats.accuracy > 50;

    this.onComplete({
      ...stats,
      isValid: valid,
      textId: this.textId,
      reason: !valid ? (this.consecutiveErrors >= 5 ? '连续错误过多' : '测试时间过短或准确率过低') : null
    });
  }
}
