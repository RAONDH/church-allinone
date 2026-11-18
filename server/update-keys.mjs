// 자동 업데이트 서명을 확인하는 공개 열쇠 (Ed25519, SPKI DER base64). 비밀 열쇠는 저장소에 없다.
// 열쇠를 바꿀 때는 새 공개 열쇠를 더하고, 옛 열쇠로 설치된 프로그램이 모두 새 버전으로 바뀐 뒤에 옛 열쇠를 뺀다.
// 만들기·서명: node installer/signing.mjs keygen | sign <폴더>
export const TRUSTED_KEYS = [
  "MCowBQYDK2VwAyEAYPzhIprGJBZvM/YRJtUvQ28RhQJN5wo8hcgECU/MD+4="
];
