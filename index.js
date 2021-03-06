if (navigator.serviceWorker){
  navigator.serviceWorker.register('/sw.js').then(function(reg) {
    console.log("registered")
    if (reg.installing){
        console.log('installing');
    } else if(reg.waiting){
        console.log('waiting');
    } else if(reg.active){
        console.log('activated');
    }
  }).catch(function(err) {
    console.log('not registered',err)
  })
}

(function() {
    'use strict';
  
    function toArray(arr) {
      return Array.prototype.slice.call(arr);
    }
  
    function promisifyRequest(request) {
      return new Promise(function(resolve, reject) {
        request.onsuccess = function() {
          resolve(request.result);
        };
  
        request.onerror = function() {
          reject(request.error);
        };
      });
    }
  
    function promisifyRequestCall(obj, method, args) {
      var request;
      var p = new Promise(function(resolve, reject) {
        request = obj[method].apply(obj, args);
        promisifyRequest(request).then(resolve, reject);
      });
  
      p.request = request;
      return p;
    }
  
    function promisifyCursorRequestCall(obj, method, args) {
      var p = promisifyRequestCall(obj, method, args);
      return p.then(function(value) {
        if (!value) return;
        return new Cursor(value, p.request);
      });
    }
  
    function proxyProperties(ProxyClass, targetProp, properties) {
      properties.forEach(function(prop) {
        Object.defineProperty(ProxyClass.prototype, prop, {
          get: function() {
            return this[targetProp][prop];
          },
          set: function(val) {
            this[targetProp][prop] = val;
          }
        });
      });
    }
  
    function proxyRequestMethods(ProxyClass, targetProp, Constructor, properties) {
      properties.forEach(function(prop) {
        if (!(prop in Constructor.prototype)) return;
        ProxyClass.prototype[prop] = function() {
          return promisifyRequestCall(this[targetProp], prop, arguments);
        };
      });
    }
  
    function proxyMethods(ProxyClass, targetProp, Constructor, properties) {
      properties.forEach(function(prop) {
        if (!(prop in Constructor.prototype)) return;
        ProxyClass.prototype[prop] = function() {
          return this[targetProp][prop].apply(this[targetProp], arguments);
        };
      });
    }
  
    function proxyCursorRequestMethods(ProxyClass, targetProp, Constructor, properties) {
      properties.forEach(function(prop) {
        if (!(prop in Constructor.prototype)) return;
        ProxyClass.prototype[prop] = function() {
          return promisifyCursorRequestCall(this[targetProp], prop, arguments);
        };
      });
    }
  
    function Index(index) {
      this._index = index;
    }
  
    proxyProperties(Index, '_index', [
      'name',
      'keyPath',
      'multiEntry',
      'unique'
    ]);
  
    proxyRequestMethods(Index, '_index', IDBIndex, [
      'get',
      'getKey',
      'getAll',
      'getAllKeys',
      'count'
    ]);
  
    proxyCursorRequestMethods(Index, '_index', IDBIndex, [
      'openCursor',
      'openKeyCursor'
    ]);
  
    function Cursor(cursor, request) {
      this._cursor = cursor;
      this._request = request;
    }
  
    proxyProperties(Cursor, '_cursor', [
      'direction',
      'key',
      'primaryKey',
      'value'
    ]);
  
    proxyRequestMethods(Cursor, '_cursor', IDBCursor, [
      'update',
      'delete'
    ]);
  
    // proxy 'next' methods
    ['advance', 'continue', 'continuePrimaryKey'].forEach(function(methodName) {
      if (!(methodName in IDBCursor.prototype)) return;
      Cursor.prototype[methodName] = function() {
        var cursor = this;
        var args = arguments;
        return Promise.resolve().then(function() {
          cursor._cursor[methodName].apply(cursor._cursor, args);
          return promisifyRequest(cursor._request).then(function(value) {
            if (!value) return;
            return new Cursor(value, cursor._request);
          });
        });
      };
    });
  
    function ObjectStore(store) {
      this._store = store;
    }
  
    ObjectStore.prototype.createIndex = function() {
      return new Index(this._store.createIndex.apply(this._store, arguments));
    };
  
    ObjectStore.prototype.index = function() {
      return new Index(this._store.index.apply(this._store, arguments));
    };
  
    proxyProperties(ObjectStore, '_store', [
      'name',
      'keyPath',
      'indexNames',
      'autoIncrement'
    ]);
  
    proxyRequestMethods(ObjectStore, '_store', IDBObjectStore, [
      'put',
      'add',
      'delete',
      'clear',
      'get',
      'getAll',
      'getKey',
      'getAllKeys',
      'count'
    ]);
  
    proxyCursorRequestMethods(ObjectStore, '_store', IDBObjectStore, [
      'openCursor',
      'openKeyCursor'
    ]);
  
    proxyMethods(ObjectStore, '_store', IDBObjectStore, [
      'deleteIndex'
    ]);
  
    function Transaction(idbTransaction) {
      this._tx = idbTransaction;
      this.complete = new Promise(function(resolve, reject) {
        idbTransaction.oncomplete = function() {
          resolve();
        };
        idbTransaction.onerror = function() {
          reject(idbTransaction.error);
        };
        idbTransaction.onabort = function() {
          reject(idbTransaction.error);
        };
      });
    }
  
    Transaction.prototype.objectStore = function() {
      return new ObjectStore(this._tx.objectStore.apply(this._tx, arguments));
    };
  
    proxyProperties(Transaction, '_tx', [
      'objectStoreNames',
      'mode'
    ]);
  
    proxyMethods(Transaction, '_tx', IDBTransaction, [
      'abort'
    ]);
  
    function UpgradeDB(db, oldVersion, transaction) {
      this._db = db;
      this.oldVersion = oldVersion;
      this.transaction = new Transaction(transaction);
    }
  
    UpgradeDB.prototype.createObjectStore = function() {
      return new ObjectStore(this._db.createObjectStore.apply(this._db, arguments));
    };
  
    proxyProperties(UpgradeDB, '_db', [
      'name',
      'version',
      'objectStoreNames'
    ]);
  
    proxyMethods(UpgradeDB, '_db', IDBDatabase, [
      'deleteObjectStore',
      'close'
    ]);
  
    function DB(db) {
      this._db = db;
    }
  
    DB.prototype.transaction = function() {
      return new Transaction(this._db.transaction.apply(this._db, arguments));
    };
  
    proxyProperties(DB, '_db', [
      'name',
      'version',
      'objectStoreNames'
    ]);
  
    proxyMethods(DB, '_db', IDBDatabase, [
      'close'
    ]);
  
    // Add cursor iterators
    // TODO: remove this once browsers do the right thing with promises
    ['openCursor', 'openKeyCursor'].forEach(function(funcName) {
      [ObjectStore, Index].forEach(function(Constructor) {
        // Don't create iterateKeyCursor if openKeyCursor doesn't exist.
        if (!(funcName in Constructor.prototype)) return;
  
        Constructor.prototype[funcName.replace('open', 'iterate')] = function() {
          var args = toArray(arguments);
          var callback = args[args.length - 1];
          var nativeObject = this._store || this._index;
          var request = nativeObject[funcName].apply(nativeObject, args.slice(0, -1));
          request.onsuccess = function() {
            callback(request.result);
          };
        };
      });
    });
  
    // polyfill getAll
    [Index, ObjectStore].forEach(function(Constructor) {
      if (Constructor.prototype.getAll) return;
      Constructor.prototype.getAll = function(query, count) {
        var instance = this;
        var items = [];
  
        return new Promise(function(resolve) {
          instance.iterateCursor(query, function(cursor) {
            if (!cursor) {
              resolve(items);
              return;
            }
            items.push(cursor.value);
  
            if (count !== undefined && items.length == count) {
              resolve(items);
              return;
            }
            cursor.continue();
          });
        });
      };
    });
  
    var exp = {
      open: function(name, version, upgradeCallback) {
        var p = promisifyRequestCall(indexedDB, 'open', [name, version]);
        var request = p.request;
  
        if (request) {
          request.onupgradeneeded = function(event) {
            if (upgradeCallback) {
              upgradeCallback(new UpgradeDB(request.result, event.oldVersion, request.transaction));
            }
          };
        }
  
        return p.then(function(db) {
          return new DB(db);
        });
      },
      delete: function(name) {
        return promisifyRequestCall(indexedDB, 'deleteDatabase', [name]);
      }
    };
  
    if (typeof module !== 'undefined') {
      module.exports = exp;
      module.exports.default = module.exports;
    }
    else {
      self.idb = exp;
    }
}());

if (!('indexedDB' in window)) {
  console.log('Browser doesn\'t support IndexedDB');
} else {
  console.log('Browser supports IndexedDB');
};

let dbPromise = idb.open('forex-db', 2, function(upgradeDb){
  let conversionRates = upgradeDb.createObjectStore('rates', {keyPath: 'query'});
  conversionRates.createIndex('query','query');
})

function updateDb(item) {
  dbPromise.then(function(db) {
    var tx = db.transaction('rates', 'readwrite');
    var rateStore = tx.objectStore('rates');
    rateStore.add(item);
    return tx.complete;
  }).then(function() {
    console.log('added item to the rateStore Object Store!');
  });
}

let result = document.querySelector('.result');
let convertCurrency = document.querySelector('#convertCurrency');
let inputAmount = document.querySelector('#amount');
let inputCurrency = document.getElementById('inputCurrency');
let outputCurrency = document.querySelector('#outputCurrency');

function showConverted() {
  let x = inputCurrency.selectedIndex;
  let y = outputCurrency.selectedIndex;
  let fromCurrency = encodeURIComponent(document.getElementsByTagName("option")[x].value);
  let toCurrency = encodeURIComponent(document.getElementsByTagName("option")[y].value);
  let query = fromCurrency + '_' + toCurrency;
  let url = `https://free.currencyconverterapi.com/api/v5/convert?q=${query}&compact=y`;

  dbPromise.then(function(db){
      let tx = db.transaction('rates', 'readwrite');
      let conversionRates = tx.objectStore('rates');
      return conversionRates.openCursor();
  }).then(function rates(cursor){
    if (!cursor ) {
      console.log('Cursor doesn\'t exist!');
      let item = {query: `${query}`, rate: `${conversionRate}`};
      updateDb(item);
      return;
    }
    for (let field in cursor.key) {
      if (cursor.key[field] == query){
        let outputAmount = cursor.value[field] * inputAmount.value;
        let conversionResult = `${fromCurrency}${inputAmount.value} equals ${toCurrency}${outputAmount}`;
        result.innerHTML = conversionResult;
      return; 
      }
    }
    return cursor.continue().then(rates);
  });

  fetch(url).then(function (response) {
    return response.json();
  }).then(function (newresponse) {
    let conversionRate = newresponse[query].val;
    let outputAmount = conversionRate * inputAmount.value;
    let conversionResult = `${fromCurrency}${inputAmount.value} equals ${toCurrency}${outputAmount}`;
    result.innerHTML = conversionResult;
  })
}

function GetData(data) {
  fetch('https://free.currencyconverterapi.com/api/v5/countries').then(function (response) {
    return response.json();
  })
  .then(function (myJson) {
    let results = myJson.results;
    for (let val in results) {
      let child = document.createElement('option');
      child.setAttribute('value', results[val].currencyId);
      child.innerHTML = `${results[val].currencyName} - ${results[val].currencyId}`;
      data.appendChild(child);
    }
  })
}

window.onload = () => {
  GetData(inputCurrency);
  GetData(outputCurrency);
}