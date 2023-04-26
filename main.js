function getRandomInt(max) {
    return Math.floor(Math.random() * max);
}

const fs = require('fs')
const http = require('http')
const https = require('https')

const express = require('express')
const cors = require('cors')
var jackpot = 0
const { Pool } = require('pg')

const app = express()

app.use(cors())

const options = {
    cert: fs.readFileSync('./certif/cert.pem'),
    key: fs.readFileSync('./certif/key.pem')
}

const port = Number(process.env.SERVER_PORT)

const pool = new Pool({
    host:       process.env.DATABASE_HOST,
    user:       process.env.DATABASE_USER,
    password:   process.env.DATABASE_PASSWORD,
    database:   "fortune_wheel_db",
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
})

// Create tables
pool.query("CREATE TABLE IF NOT EXISTS users (vk_id integer, balance integer)")
    .then((q_res)=>{
        // console.log(q_res)
    })
    .catch((err)=>{
        console.error("Error create users table", err)
    })

pool.query("CREATE TABLE IF NOT EXISTS roll_logs (vk_id integer, win_value integer, timestamp integer)")
    .then((q_res)=>{
        // console.log(q_res)
    })
    .catch((err)=>{
        console.error("Error create roll_logs table", err)
    })

pool.query("CREATE TABLE IF NOT EXISTS jackpot (result integer)")
    .then((q_res)=>{
        // console.log(q_res)
    })
    .catch((err)=>{
        console.error("Error create jackpot table", err)
    })

//Load jackpot
pool.query("SELECT result FROM jackpot")
    .then((q_res)=>{
        if(q_res.length != 0){
            jackpot = q_res.rows[0]
            if(jackpot === NaN || jackpot === undefined)
                jackpot = 0
        }
    })
    .catch((err)=>{
        console.error("Error get jackpot", err)
    })

//Create user
async function createUser(vk_id){
    try{
        const q_result = await pool.query("INSERT INTO users (vk_id, balance) VALUES ($1::integer, 100)", [vk_id])
        if(q_result.rows.length === 0){
            return null;
        }
        return q_result.rows[0]
    }
    catch(err){
        console.error("Error creating user", err)
    }
    return null;
}

//Get user or create
async function getUserOrCreate(vk_id){
    try{
        const q_result = await pool.query("SELECT * FROM users WHERE vk_id = $1::integer", [vk_id])
        if(q_result.rows.length === 0){
            return await createUser(vk_id);
        }
        return q_result.rows[0];
    }
    catch(err){
        console.error("Error fetching user by VK id", err)
    }
    return null;
}

//Update user
async function updateUser(user){
    try{
        const q_result = await pool.query("UPDATE users SET balance = $2::integer WHERE vk_id = $1::integer", [user.vk_id, user.balance])
        return q_result.rows[0]
    }catch(err){
        console.error("Error updating user", err)
        return null
    }
}

//Save user roll
async function saveRoll(user, win_value){
    try{
        const q_result = await pool.query("INSERT INTO roll_logs (vk_id, win_value, timestamp) VALUES ($1::integer, $2::integer, $3::integer)", [user.vk_id, win_value, Math.floor((new Date()).getTime()/1000)])
        return q_result.rows[0]
    }catch(err){
        console.error("Error save user roll", err)
        return null;
    }
}

//Get last 5 rolls
async function getLastWinners(){
    try{
        const q_result = await pool.query("SELECT * FROM roll_logs ORDER BY timestamp DESC LIMIT 5")
        return q_result.rows
    }catch(err){
        console.error("Error fetching rolls", err)
        return null;
    }
}

app.get('/api/user/', async (req, res) => {
    const vk_id = req.get("Authorization");
    if(vk_id === undefined){
        res.status(401).send("Authorization header required")
        return
    }

    var user = await getUserOrCreate(vk_id);
    if(user === null){
        res.status(500).send("Internal server error")
    }else{
        res.status(200).set({'Content-Type': 'application/json'}).json(user)
    }
    
})

app.post('/api/roll/', async (req, res)=>{
    const vk_id = req.get("Authorization");
    if(vk_id === undefined){
        res.status(401).send("Authorization header required")
        return
    }

    var user = await getUserOrCreate(vk_id);
    if(user.balance < 10){
        res.status(400).send("Insufficient funds on the balance sheet")
        return
    }

    const wheel_section = getRandomInt(8);
    user.balance -= 10
    var jackpotBackup = jackpot
    var win_value = 0;
    jackpot += 10
    switch(wheel_section){
        case 0:
            win_value += 0
            break;
        case 1:
            win_value += 10
            break;
        case 2:
            win_value += 50
            break;
        case 3:
            win_value += 100
            break;
        case 4:
            win_value += 200
            break;
        case 5:
            win_value += 500
            break;
        case 6:
            win_value += 750
            break;
        case 7:
            user.balance += jackpot
            jackpot = 0
            break;
    }
    user.balance += win_value

    //Save roll
    if(saveRoll(user, win_value)===null){
        jackpot = jackpotBackup
        res.status(500).send("Internal server error")
        return
    }

    //Save jackpot
    try{
        const q_res = await pool.query("UPDATE jackpot SET result = $1::integer", [jackpot])
    }catch(err){
        jackpot = jackpotBackup
        console.error("Error updating jackpot",err)
        res.status(500).send("Internal server error")
        return
    }

    //Save user
    var updatedUser = await updateUser(user)
    if(updatedUser === null){
        jackpot = jackpotBackup
        res.status(500).send("Internal server error")
        return
    }

    res.status(200).set({'Content-Type': 'application/json'}).json({user, wheel_section})
})

app.get("/api/jackpot/", async (req, res)=>{
    res.status(200).json({jackpot})
})

app.get("/api/rolls/", async (req, res)=>{
    var rolls = await getLastWinners()
    if(rolls == null){
        res.status(500).send("Internal server error")
        return
    }

    res.status(200).set({'Content-Type': 'application/json'}).json(rolls)
})

https.createServer(options,app).use(cors()).listen(port, ()=>{console.log(`Example app listening on port ${port}`)})