// @vitest-environment jsdom
import {expect,it} from "vitest";
import {installInputDiagnostics} from "./input-diagnostics";
it("does not record key codes or focus/input events from private and password controls",()=>{
 const stop=installInputDiagnostics("?input-diagnostics"),field=document.createElement("textarea"),password=document.createElement("input");field.dataset.private="true";password.type="password";document.body.append(field,password);
 try{for(const element of [field,password]){element.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"s",code:"KeyS"}));element.dispatchEvent(new InputEvent("beforeinput",{bubbles:true,data:"SECRET",inputType:"insertText"}));element.dispatchEvent(new FocusEvent("focusin",{bubbles:true}));}
 const read=(window as unknown as {__arkenInputDiagnostics:()=>unknown[]}).__arkenInputDiagnostics;expect(read()).toHaveLength(0);
 document.body.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"Escape",code:"Escape"}));expect(read()).toHaveLength(1);
 }finally{stop();field.remove();password.remove();}
});
