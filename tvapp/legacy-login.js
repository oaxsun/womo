/* Womo TV legacy login / PIN diagnostic route for webOS 2.0 (ES5 only). */
(function () {
  'use strict';
  var config = {apiKey:'AIzaSyBGUUoYmYNcQk_T7QvDUKwZmNh-nHOwENY',authDomain:'womo-5d922.firebaseapp.com',projectId:'womo-5d922',storageBucket:'womo-5d922.firebasestorage.app',messagingSenderId:'760499593073',appId:'1:760499593073:web:c1a8605da3f0892e53a0d0'};
  function el(id){return document.getElementById(id);}
  function text(id,value){if(el(id))el(id).textContent=value;}
  function view(name){var ids=['loginScreen','pairScreen','playerScreen'];for(var i=0;i<ids.length;i++){el(ids[i]).style.display=ids[i]===name?'block':'none';el(ids[i]).hidden=ids[i]!==name;}}
  function fail(message){text('tvLoginStatus',message);}
  function err(e){return e && e.code ? e.code : (e && e.message ? e.message : 'error desconocido');}
  function boot(){
    view('loginScreen');
    if(!window.firebase || !firebase.auth || !firebase.firestore){fail('Firebase no cargó. Comprueba la fecha de la TV y la conexión HTTPS. Diagnóstico LG v7.');return;}
    try {if(!firebase.apps.length)firebase.initializeApp(config);}catch(e){fail('Firebase init: '+err(e));return;}
    var auth=firebase.auth(), db=firebase.firestore(), currentRef=null, unsub=null, heartbeat=null;
    function showPair(user){view('pairScreen');text('tvAccountLabel','Sesión iniciada como '+(user.email||'usuario Womo'));text('tvStatus','Ingresa el PIN generado desde tu celular.');}
    function showLinked(){view('pairScreen');el('tvPairForm').style.display='none';el('tvLogoutBtn').style.display='none';el('tvExitBtn').style.display='inline-block';var h=el('pairScreen').getElementsByTagName('h1')[0];if(h)h.textContent='Pantalla vinculada';text('tvStatus','Pantalla conectada. Elige un título desde el celular.');}
    auth.onAuthStateChanged(function(user){if(user){showPair(user);}else{view('loginScreen');fail('Inicia sesión con tu cuenta Womo.');}},function(e){fail('Error autenticación: '+err(e));});
    el('tvLoginForm').onsubmit=function(event){if(event && event.preventDefault)event.preventDefault();var email=el('tvEmailInput').value.replace(/^\s+|\s+$/g,''), password=el('tvPasswordInput').value;if(!email||!password){fail('Escribe correo y contraseña.');return false;}el('tvLoginBtn').disabled=true;fail('Conectando con Firebase...');auth.signInWithEmailAndPassword(email,password).then(function(){fail('Sesión iniciada.');},function(e){fail('Error de acceso: '+err(e));}).then(function(){el('tvLoginBtn').disabled=false;});return false;};
    function pairWithPin(ref,user){
      currentRef=ref;
      return ref.set({status:'paired',tvConnectedAt:Date.now(),tvLastSeenAt:Date.now(),tvUserId:user.uid,tvUserEmail:user.email||'',playerState:{status:'connected',updatedAt:Date.now()}},{merge:true}).then(function(){
        showLinked();
        unsub=ref.onSnapshot(function(s){
          var d=s.data()||{};
          if(d.status==='disconnected'){
            if(unsub)unsub();unsub=null;currentRef=null;
            if(heartbeat)clearInterval(heartbeat);heartbeat=null;
            el('tvPairForm').style.display='block';
            el('tvLogoutBtn').style.display='inline-block';
            el('tvExitBtn').style.display='none';
            showPair(user);
          }
          if(d.currentCommand&&d.currentCommand.type==='play')text('tvStatus','Comando recibido. Reproducción pendiente de compatibilidad multimedia de webOS.');
        },function(e){text('tvStatus','Error sesión: '+err(e));});
        heartbeat=setInterval(function(){if(currentRef)currentRef.set({tvLastSeenAt:Date.now()},{merge:true});},20000);
      });
    }
    el('tvPairForm').onsubmit=function(event){
      if(event&&event.preventDefault)event.preventDefault();
      var code=el('tvCodeInput').value.replace(/\D/g,'').substring(0,6),user=auth.currentUser;
      if(code.length!==6){text('tvStatus','Escribe los 6 dígitos.');return false;}
      if(!user){view('loginScreen');return false;}
      text('tvStatus','Buscando PIN...');
      db.collection('tvSessions').doc(code).get().then(function(snap){
        if(!snap.exists){text('tvStatus','Código no encontrado.');return;}
        var d=snap.data()||{};
        if(d.createdBy!==user.uid){text('tvStatus','El PIN pertenece a otra cuenta.');return;}
        if(d.status==='paired'||d.status==='tv_connected')return pairWithPin(snap.ref,user);
        if(!d.createdAtServer||!d.createdAtServer.toMillis){text('tvStatus','Genera un PIN nuevo desde tu celular.');return;}
        return snap.ref.set({pinCheckedAtServer:firebase.firestore.FieldValue.serverTimestamp()},{merge:true})
          .then(function(){return snap.ref.get({source:'server'});})
          .then(function(checked){
            var current=checked.data()||{};
            var issued=current.createdAtServer&&current.createdAtServer.toMillis?current.createdAtServer.toMillis():0;
            var verified=current.pinCheckedAtServer&&current.pinCheckedAtServer.toMillis?current.pinCheckedAtServer.toMillis():0;
            if(!issued||!verified){text('tvStatus','No se pudo validar la hora de Firebase. Reintenta.');return;}
            if(verified-issued>Number(current.pinTtlMs||1800000)){text('tvStatus','El PIN expiró. Genera uno nuevo.');return;}
            return pairWithPin(snap.ref,user);
          });
      }).catch(function(e){text('tvStatus','Error Firebase: '+err(e));});
      return false;
    };
    el('tvLogoutBtn').onclick=function(){auth.signOut();};
    el('tvExitBtn').onclick=function(){if(heartbeat)clearInterval(heartbeat);if(unsub)unsub();if(currentRef)currentRef.set({status:'disconnected'},{merge:true});currentRef=null;el('tvPairForm').style.display='block';el('tvLogoutBtn').style.display='inline-block';el('tvExitBtn').style.display='none';showPair(auth.currentUser);};
  }
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',boot);}else{boot();}
}());
