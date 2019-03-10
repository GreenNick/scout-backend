const express = require('express')
const cheerio = require('cheerio')
const fetch = require('node-fetch')
const app = express()
const PORT = process.env.PORT || 5000

//Utility Functions
const compose = async (output, func) => output.then(func)
const pipe = (...funcs) =>
  value => funcs.reduce(compose, Promise.resolve(value))
const merge = (acc, currVal) => ({ ...acc, ...currVal })

//Filter Callbacks
const filterTruthy = i => i
const filterTeam = team => obj => obj.team === team
const filterProp = prop => obj => obj[prop]

//Reduce Callbacks
const reduceProp = prop => (acc, currVal) => acc + currVal[prop]
const reduceMatches = (acc, currVal) => acc + currVal.wins + currVal.losses + currVal.ties
const max = prop => (acc, currVal) => currVal[prop] > acc ? currVal[prop] : acc

const trimWhitespace = i => i.trim()
const getResponse = url => fetch(url)
const getHtml = res => res.text()
const getJson = res => res.json()
const getResult = res => res.result
const loadPage = html => cheerio.load(html)
const scrapeTeams = $ => $('#data-table > tbody > tr > td:first-of-type')
const teamsToArray = teams => teams.text().split('\n').map(trimWhitespace).filter(filterTruthy)
const getSkills = res => res.size ? res.result[0].score : 0

const fetchTeams = () => {
  const url = 'https://www.robotevents.com/robot-competitions/vex-robotics-competition/RE-VRC-18-6082.html'
  
  return pipe(
    getResponse,
    getHtml,
    loadPage,
    scrapeTeams,
    teamsToArray
  )(url)
}

const fetchSkills = teams =>
  Promise.all(teams.map(async team => {
    const url = `https://api.vexdb.io/v1/get_skills?season_rank=true&team=${team}&season=current&type=2`
    const skills = await pipe(
      getResponse,
      getJson,
      getSkills
    )(url)

    return { team, skills }
  }))

const fetchMatchScore = teams =>
  Promise.all(teams.map(async team => {
    const url = `https://api.vexdb.io/v1/get_matches?team=${team}&season=current&round=2`
    const sumMatchScore = (acc, currVal) =>
      (team === currVal.red1 || team === currVal.red2)
        ? acc + currVal.redscore
        : acc + currVal.bluescore
    const avgMatchScore = matches =>
      matches.reduce(sumMatchScore, 0) / matches.length
    const avgScore = await pipe(
      getResponse,
      getJson,
      getResult,
      avgMatchScore
    )(url)

    return { team, avgScore }
  }))

const fetchRanks = teams =>
  Promise.all(teams.map(async team => {
    const url = `https://api.vexdb.io/v1/get_rankings?season=current&team=${team}`
    const events = await pipe (
      getResponse,
      getJson,
      getResult
    )(url)
    const matchNum = events.reduce(reduceMatches, 0)

    return {
      team,
      avgOPR: events.reduce(reduceProp('opr'), 0) / events.filter(filterProp('opr')).length,
      avgDPR: events.reduce(reduceProp('dpr'), 0) / events.filter(filterProp('dpr')).length,
      avgCCWM: events.reduce(reduceProp('ccwm'), 0) / events.filter(filterProp('ccwm')).length,
      highScore: events.reduce(max('max_score'), 0),
      wins: events.reduce(reduceProp('wins'), 0),
      losses: events.reduce(reduceProp('losses'), 0),
      ties: events.reduce(reduceProp('ties'), 0),
      winPer: events.reduce(reduceProp('wins'), 0) / matchNum,
      autoWinPer: events.reduce(reduceProp('ap'), 0) / (matchNum * 4)
    }
  }))

const centralizeData = async teams => {
  const skills = await fetchSkills(teams)
  const ranks = await fetchRanks(teams)
  const score = await fetchMatchScore(teams)

  return {
    teams: [...teams],
    stats: [...skills, ...ranks, ...score]
  }
}

const filterData = data =>
  data.teams.map(team =>
    data.stats
      .filter(filterTeam(team))
      .reduce(merge)
  )

const getData = pipe(centralizeData, filterData)

app.get('/api', async (req, res) => {
  const teams = await fetchTeams()
  const data = await getData(teams)
  res.send(data)
})

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`)
})