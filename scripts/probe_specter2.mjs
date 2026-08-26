const b = await (await fetch("https://cdn.protect.clerk.com/ins_2dkzDoDZRl1ShmWomHR110Rr5EY/c/1-m4uicibgm6t3qkxkguyhtgbryy-mxu7qsqn4wgirnhbewjqqq7ixq/bootstrap.js?v=6.30.1", { headers: { "User-Agent": "Mozilla/5.0" } })).text()
console.log(b.slice(3000, 6715))
