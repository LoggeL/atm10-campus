for(const button of document.querySelectorAll('button[data-enabled]'))button.addEventListener('click',async()=>{
  button.disabled=true;
  try{
    const response=await fetch('/api/projects/erebor/planfolge/dreierbetrieb',{
      method:'POST',headers:{'content-type':'application/json','x-campus-csrf':'1'},
      body:JSON.stringify({version:Number(button.dataset.version),enabled:button.dataset.enabled==='true',
        ...(button.id==='all-mains'?{allMains:true}:{})})
    });
    if(!response.ok)throw Error((await response.json()).error||'Änderung fehlgeschlagen.');
    location.reload();
  }catch(error){
    document.getElementById('result').textContent=' '+error.message;
    button.disabled=false;
  }
});
