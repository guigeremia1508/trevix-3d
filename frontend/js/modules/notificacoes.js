async function refreshNotificationCount(){try{const rows=await API.get('/notifications');const el=R('notifications-count');if(!el)return;el.textContent=Math.min(rows.length,99);el.style.display=rows.length?'inline-block':'none';}catch{}}
window.refreshNotificationCount=refreshNotificationCount;
