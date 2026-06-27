# NET-zero 내부 README

이 폴더는 GitHub Pages로 배포되는 정적 웹 앱의 실제 소스입니다.

배포 주소: [https://arcana7642.github.io/NET-zero/](https://arcana7642.github.io/NET-zero/)

## 앱 개요

강의 시간표 CSV를 바탕으로 시간대별 엘리베이터 수요를 만들고, 여러 운행 정책에 따라 엘리베이터 정차층과 대기 시간을 시뮬레이션합니다.

브라우저에서 바로 동작하는 정적 앱이며, 별도 서버나 `.bat` 실행은 필요 없습니다.

## 주요 파일

- `index.html`: 화면 구조와 기본 입력값
- `styles.css`: 화면 스타일
- `app.js`: CSV 파싱, 수요 생성, 운행 시뮬레이션, 화면 렌더링
- `lecture_room_time_course.csv`: 기본 강의 시간표 데이터
- `lecture_data.js`: `file://` 직접 실행 시 사용하는 CSV 백업 데이터
- `optimal_custom.js`: 사전 계산된 `opt` 정책 데이터
- `carbon.js`: 탄소 절감 패널 관련 코드

## 기본 설정

- 기본 요일: 월요일
- 기본 정책: 홀짝
- 수요 시드: 2026
- 엘리베이터 수: 3대
- 정원: 20명
- 총 층수: 14층
- 로비층: 1층
- 층간 이동 시간: 3초
- 학생 수 범위: 강의당 25-30명

정차 시간 기본값:

- 감속: 1-2초
- 문 열림: 2초
- 승하차: 6-10초
- 문 닫힘: 2초
- 재가속: 1-2초

운행 시드는 별도 입력으로 받지 않고, 내부에서 수요 시드 기준으로 자동 처리합니다.

## 운행 정책

- `홀짝`: 엘리베이터별 홀수층/짝수층 중심 배정
- `구간`: 층 구간을 나누어 배정
- `전체`: 모든 엘리베이터가 모든 층 담당
- `혼합`: 홀짝과 구간 우선 정책을 섞어 배정
- `커스텀`: 사용자가 엘리베이터별 담당층을 직접 선택
- `opt`: 사전 계산 또는 즉석 계산을 통해 시간대별 담당층을 최적화

모든 정책에서 1층은 선택된 담당층에 포함됩니다.

## 커스텀/opt 동작

E1은 전층 담당 엘리베이터로 고정됩니다. 나머지 엘리베이터는 정책 또는 사용자의 선택에 따라 담당층이 정해집니다.

`opt`는 30분 시간대별 수요를 기준으로 담당층 조합을 평가해 소요 시간이 짧은 배정을 사용합니다. 사전 계산 데이터가 현재 기본 설정과 맞으면 `optimal_custom.js`를 사용하고, 맞지 않으면 브라우저에서 즉석 계산합니다.

## 배포 방식

현재 GitHub Pages는 `gh-pages` 브랜치의 루트 파일을 기준으로 배포합니다. 배포 대상 파일은 다음과 같습니다.

- `index.html`
- `styles.css`
- `app.js`
- `lecture_data.js`
- `optimal_custom.js`
- `carbon.js`
- `lecture_room_time_course.csv`
- `.nojekyll`

수정 후 배포할 때는 `main` 브랜치에 변경사항을 커밋하고, 같은 정적 파일 묶음을 `gh-pages` 브랜치에 갱신하면 됩니다.

## 데이터 수정 시 주의

`lecture_room_time_course.csv`를 바꾸면 서버 배포 환경에서는 바로 새 CSV를 읽습니다.

다만 로컬에서 `file://`로 직접 열 때도 같은 데이터를 쓰려면 `lecture_data.js`를 다시 생성해야 합니다.

```powershell
node -e "const fs=require('fs');fs.writeFileSync('lecture_data.js','window.EMBEDDED_LECTURE_CSV = '+JSON.stringify(fs.readFileSync('lecture_room_time_course.csv','utf8'))+';\n')"
```

`opt` 사전 계산 결과까지 갱신하려면 아래 스크립트를 실행합니다.

```powershell
node precompute_optimal.js
```

사전 계산은 데이터와 설정에 따라 오래 걸릴 수 있습니다.
