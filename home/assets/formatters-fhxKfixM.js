const o=(t,e=1)=>{const i=Math.max(0,Math.min(20,Math.round(e))),n=Number(t);if(!isFinite(n)||t==="")return"-";const r=10**i;return(Math.round(n*r)/r).toFixed(i)};export{o as f};
