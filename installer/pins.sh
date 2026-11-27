# 배포 묶음에 넣는 바깥 부품의 고정 버전 (make-package.sh · make-windows.sh 가 함께 씀)
# 그 저장소의 main 이 바뀌어도 점검하지 않은 코드가 배포 파일에 들어가지 않도록 커밋을 못 박아 둔다.
# 새 버전을 넣으려면: gh api repos/raon-easypaster/hwp-pdf-to-markdown/commits/main -q .sha 로 확인해 바꾼 뒤 전체 점검·설치 확인.
HWP_REPO="raon-easypaster/hwp-pdf-to-markdown"
HWP_COMMIT="72d72ca0aad3237108fece997f77b628cededa1f"
