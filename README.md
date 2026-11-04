# 오늘 얼마 썼어? (voice-budget)

한국어 음성으로 지출·입금을 기록하는 아이폰용 가계부 웹앱 (PWA). 현재 버전 v0.9.1.

- 무료 규칙 기반 (AI API 사용 안 함), 데이터는 폰 안(localStorage)에만 저장
- 지출/입금 음성 입력, 지난 날짜로 기록, 질문으로 찾기, 월 예산 경고, 카테고리 차트, 월별 엑셀 내보내기

## 사용
GitHub Pages로 배포한 주소를 아이폰 Safari로 열고 공유 → "홈 화면에 추가".

## 파일
- `index.html` 화면 · `app.js` 앱 동작 · `parser.js` 한국어 해석 · `sw.js` 오프라인 · `lib/xlsx.full.min.js` 엑셀
