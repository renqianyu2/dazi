const { pinyin } = require('pinyin-pro');

// 将汉字转换为拼音数组
function textToPinyin(text) {
  return pinyin(text, {
    toneType: 'none',
    type: 'array'
  });
}

// 验证输入的拼音是否正确
function validatePinyin(char, input) {
  const correctPinyin = pinyin(char, { toneType: 'none' });
  return input.toLowerCase() === correctPinyin.toLowerCase();
}

// 获取文本的拼音提示
function getPinyinHints(text) {
  const chars = text.split('');
  return chars.map(char => {
    if (/[\u4e00-\u9fa5]/.test(char)) {
      return pinyin(char, { toneType: 'none' });
    }
    return char;
  });
}

module.exports = {
  textToPinyin,
  validatePinyin,
  getPinyinHints
};
