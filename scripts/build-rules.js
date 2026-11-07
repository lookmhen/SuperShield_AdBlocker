// scripts/build-rules.js
import https from 'node:https';
import fs from 'node:fs';

https.get('https://raw.githubusercontent.com/Turtlecute33/toolz/master/src/d3host.adblock', (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    const lines = data.split('\n');
    const benchmarkDomains = new Set();
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('||') && trimmed.endsWith('^')) {
        benchmarkDomains.add(trimmed.slice(2, -1));
      }
    }

    // Additional domains for comprehensive ad networks & streaming sites
    const extraDomains = [
      'doubleclick.net',
      'googlesyndication.com',
      'googleadservices.com',
      'taboola.com',
      'outbrain.com',
      'popads.net',
      'propellerads.com',
      'adsterra.com',
      'criteo.com',
      'criteo.net',
      'amazon-adsystem.com',
      'adnxs.com',
      'rubiconproject.com',
      'pubmatic.com',
      'openx.net',
      'casalemedia.com',
      'smartadserver.com',
      'revcontent.com',
      'mgid.com',
      'adcolony.com',
      'imasdk.googleapis.com',
      'moatads.com',
      '1xbet.com',
      'ufabet.com',
      'bet365.com',
      'sbobet.com'
    ];

    for (const d of extraDomains) {
      benchmarkDomains.add(d);
    }

    const rules = [
      {
        id: 1,
        priority: 3,
        action: {
          type: 'redirect',
          redirect: {
            extensionPath: '/surrogates/adsbygoogle.js'
          }
        },
        condition: {
          urlFilter: '||pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
          resourceTypes: ['script']
        }
      },
      {
        id: 2,
        priority: 3,
        action: {
          type: 'redirect',
          redirect: {
            extensionPath: '/surrogates/prebid.js'
          }
        },
        condition: {
          urlFilter: '||cdn.jsdelivr.net/*/prebid*.js',
          resourceTypes: ['script']
        }
      },
      {
        id: 3,
        priority: 2,
        action: { type: 'block' },
        condition: {
          urlFilter: '*pagead.js*',
          resourceTypes: ['script', 'xmlhttprequest', 'other', 'sub_frame']
        }
      },
      {
        id: 4,
        priority: 2,
        action: { type: 'block' },
        condition: {
          urlFilter: '*widget/ads.*',
          resourceTypes: ['script', 'xmlhttprequest', 'other', 'sub_frame']
        }
      },
      {
        id: 5,
        priority: 2,
        action: { type: 'block' },
        condition: {
          urlFilter: '*/ads.js*',
          resourceTypes: ['script', 'xmlhttprequest', 'other', 'sub_frame']
        }
      },
      {
        id: 6,
        priority: 2,
        action: { type: 'block' },
        condition: {
          urlFilter: '||cutt.ly/*1xbet*',
          resourceTypes: ['sub_frame', 'script', 'image', 'xmlhttprequest']
        }
      }
    ];

    let currentId = 7;
    for (const domain of benchmarkDomains) {
      if (domain === 'pagead2.googlesyndication.com/pagead/js/adsbygoogle.js') continue;

      rules.push({
        id: currentId++,
        priority: 1,
        action: { type: 'block' },
        condition: {
          urlFilter: `||${domain}^`,
          resourceTypes: ['script', 'image', 'sub_frame', 'xmlhttprequest', 'ping', 'other']
        }
      });
    }

    fs.writeFileSync('rules/ad-rules.json', JSON.stringify(rules, null, 2));
    console.log('Successfully generated rules/ad-rules.json with ' + rules.length + ' rules');
  });
});
