(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.IWSMAuthCore=factory();})(typeof window==='object'?window:globalThis,()=>({
 target(value){return /^\/?strategy-builder\.html(?:#[\w-]*)?$/.test(String(value))?'/'+String(value).replace(/^\//,''):'/strategy-builder.html';},
 async verified(auth){try{const {data,error}=await auth.getUser();return !error&&!!data?.user?.id;}catch{return false;}}
}));
