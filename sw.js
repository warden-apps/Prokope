/* Prokope - network first, cache as the fallback.
   Always fresh online; still opens with no signal. */
var CACHE = "prokope-v3";
var CORE = ["./", "./index.html", "./manifest.json",
            "./apple-touch-icon.png", "./icon-512.png"];

self.addEventListener("install", function(e){
  e.waitUntil(
    caches.open(CACHE).then(function(c){ return c.addAll(CORE); })
      .catch(function(){})                      /* a miss here must not block install */
      .then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function(e){
  e.waitUntil(
    caches.keys().then(function(ks){
      return Promise.all(ks.map(function(k){ return k===CACHE ? null : caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function(e){
  var req = e.request;
  if(req.method !== "GET") return;
  if(new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then(function(res){
      if(res && res.status === 200){
        var copy = res.clone();
        caches.open(CACHE).then(function(c){ c.put(req, copy); }).catch(function(){});
      }
      return res;
    }).catch(function(){
      return caches.match(req).then(function(hit){
        return hit || caches.match("./index.html") || caches.match("./");
      });
    })
  );
});
