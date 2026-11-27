import {describe,it,expect} from "vitest";
import {peerCommandErrorMessage,uploadCommandErrorMessage} from "./command-error-messages";
describe("safe command error wording",()=>{
 it("uses the same Russian image refusal for HTTP and peer",()=>{
  for(const code of ["IMAGE_TOO_LARGE","UNSUPPORTED_FILE_TYPE","UPLOAD_HASH_MISMATCH"]){expect(uploadCommandErrorMessage(code)).toBe(peerCommandErrorMessage(code));expect(uploadCommandErrorMessage(code)).not.toContain(code);}
 });
 it("does not interpret object prototype properties or private unknown codes",()=>{
  for(const code of ["constructor","__proto__","PRIVATE_SQL"]){expect(uploadCommandErrorMessage(code)).toBe("Не удалось загрузить изображение.");expect(peerCommandErrorMessage(code)).toBe("Не удалось подтвердить действие. Проверьте состояние кампании.");}
 });
});
