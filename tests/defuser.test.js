// tests/defuser.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

test('defuser-main.js stubs anti-adblock detection variables on window', () => {
  const defuserMainCode = fs.readFileSync('content-scripts/defuser-main.js', 'utf8');
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { runScripts: "dangerously" });
  dom.window.eval(defuserMainCode);
  
  assert.equal(dom.window.canRunAds, true);
  assert.equal(dom.window.isAdBlockActive, false);
  assert.ok(dom.window.adsbygoogle);
  assert.equal(typeof dom.window.adsbygoogle.push, 'function');
  dom.window.close();
});

test('defuser-isolated.js dismisses anti-adblock modal and restores scroll', () => {
  const defuserIsolatedCode = fs.readFileSync('content-scripts/defuser-isolated.js', 'utf8');
  const dom = new JSDOM(`<!DOCTYPE html>
    <html style="overflow: hidden">
      <body style="overflow: hidden">
        <div id="adblock-modal-overlay" class="adblock-warning-popup" style="position:fixed">
          Please disable AdBlock
        </div>
      </body>
    </html>`, { runScripts: "dangerously" });

  dom.window.eval(defuserIsolatedCode);
  
  assert.equal(dom.window.document.getElementById('adblock-modal-overlay'), null);
  assert.notEqual(dom.window.document.body.style.overflow, 'hidden');
  dom.window.close();
});
