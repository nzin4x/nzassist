버그 하나
9월 7일 22시에 9/7 21:00 입력하면, 1년 후가 되어야 할 듯. 과거의 알람은 없으니까. 

# 입력 중, 추천 목록
그리고 # 입력하면 tag 추천 목록이 떠야 하는데 안 뜬다. @ 입력하면 context 추천 목록이 떠야 하는데 안 뜨고
@ 를 2번 입력했으면 "뒤의 것이" 추천으로 들어간다. 즉, 입력중 자동감지된 것이, 우선권을 갖는다

# 레이아웃 문제 및 편집 화면의 제공
시간이 없는 것을 "목록" 에서 + 시간을 누르게 되면, 제목이 세로열로 죽 길어지면서 레이아웃이 깨진다.
지금 편집 기능 자체가 없어. 제목을 클릭하면 편집 모드로 들어가야 해, 공돌이형 task 매니저이므로, 별도의 항목별 편집 UI는 불필요 할 듯. 입력 기반으로 간다.

# 단축키와 명령어 pallete 기능
google task 의 핵심 기능 "star" 체크는 한번에 할 수 있도록 한다. 
마우스로 목록을 클릭하면 해당건의 "선택"
컨트롤 누르면 다른거 누르면 "다건 선택 모드" 가 활성화 된다.
이 때 키보드로 
s 를 누르면 star 
S 누르면 sub task 추가 모드
d 누르면 삭제 "단 conform 후"
D 누르면 강제 삭제
u 누르면 모든 명령에 대한 "undo"
e 누르면 편집 모드 (i 도 vi 에서 차용한 입력 모드)
e 누르면 편집 모드인데 2번째 줄부터는 메모니까 아래 화살표 누르면, 메모 편집 창으로 갈 수 있겠지?
/ 는 검색창으로 focus (vi 에서 차용)
f 누르면 검색이기는 한데 그야말로 눈에 보이는 task 로 빠르게 가기위한 incremental search 야, esc 누르면 중지되고
p 누르면 postpone 이야 (다건 선택에서도 동일하게 되며, 얼마나 연장할지 ask box 가 떠서 1h 2d 3m 등으로 입력 받을 수 있어)
? 누르면 준비된 명령들이 layered popup 으로 펼쳐진다
c 누르면 입력 모드로 포커스 (포커스 중이라는 것을 테두리로 이쁘게 보여준다)
입력중에 esc 누르면, 목록 선택 모드
j k 는 목록 이동 (vi 에서 차용)
p 누르면 pallete 명령 입력 모드
delete list 같은 예외적인 것을 처리 할 수 있어.
r 새로고침


# 검색
UI 상에서 TAG 별로 모아보는 기능이 있어야 해, 
unified search 창이 맨 위에 있어서 
기본적으로 제목 검색은 물론
# 를 이용한 tag 검색 <- 추천도 되어야 한다
@ 를 이용한 context 검색도 and 조건으로 엮인다.
가장 중요한 검색 기능은
updated < 1d 와 같이, 하루중에 변경된 것 보기
created < 10d 와 같이 "생성된지 10일 이내의 건 보기" 등 JIRA JQL 기법을 따른다. and or 조건 ( ) 를 이용한 sub query 는 물론이다. 모든 입력은 되도록 "추천사항" 이 뜰 수 있다

# 메모는
live markdown render 하면 된다.

# 디자인
css 를 전반적으로 가다듬어야 해. 최대한 google calendar 에 맞추어 밝고 화사한 그러나 concise 한 디자인으로 해  @pasted-image-2026-09-07T13-33-01.png 

# 입력중 parsing result
입력이 어떻게 될 것이다라는 미리보기 화면은 "입력상자 처럼 보이기 보다는 디자인을 좀 더 바꿔봐봐

그리고 입력시 첫째줄은 제목란이고 shift enter 를 통해서 "추가로 아무 노트" 나 입력할 수 있다. macos memo 앱 처럼, 첫줄은 언제나 볼드 라지지만 둘째줄 부터는 그저 아주 간단한 markup 을 지원하는 텍스트 공간이라고 볼 수 있다. 링크가 있다면 파란색으로 표현하는 것 정도는 센스

너무 길 수 있으니 잘릴 것을 가정하여 g task 나 g cal의 최대 자릿수를 파악해서 입력 가능한 자릿수를 표현하면 된다.

#sub task
편집 모드에서는 하위 task 를 만들 수 있다. 
편집 모드에서 "하위 task 추가" 버튼을 누르면 하나씩 추가 할 수 있다.

# 완료된 task 의 archiving
완료된 task 는 google spreadsheet 에 archive 된다. 
https://console.cloud.google.com/marketplace/product/google/sheets.googleapis.com?q=search&referrer=search&hl=ko&project=nzin4x
에러 미리 해놨어
nzassist-archive 의 nztodo tab 에 기록 관리 할 수 있다
archiving 은 할일로만 남겨두고 실제 구현은 하지 않는다
