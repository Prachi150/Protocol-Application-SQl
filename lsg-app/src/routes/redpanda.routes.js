const express = require('express');
const router = express.Router();
const jwtAuth = require('../middleware/jwtAuth');
const {
    getStatus,
    getBrokerConfig, setBrokerConfig, restartBroker, getBrokerTopics,
    getConsumerGroups, getTopics,
    listPipelines, getPipeline, validatePipeline,
    applyPipeline, updatePipeline, removePipeline, pipelineAction,
    getLogs,
} = require('../controllers/redpanda.controller');

const json = express.json();

// Status
router.get('/status',           jwtAuth, getStatus);

// Broker config
router.get('/broker/config',    jwtAuth, getBrokerConfig);
router.post('/broker/config',   jwtAuth, json, setBrokerConfig);
router.post('/broker/restart',  jwtAuth, restartBroker);
router.get('/broker/topics',    jwtAuth, getBrokerTopics);
router.get('/consumers',        jwtAuth, getConsumerGroups);
router.get('/topics',           jwtAuth, getTopics);

// Pipelines
router.get('/pipelines',            jwtAuth, listPipelines);
router.get('/pipeline/:name',       jwtAuth, getPipeline);
router.post('/pipeline/validate',   jwtAuth, json, validatePipeline);
router.post('/pipeline',            jwtAuth, json, applyPipeline);
router.put('/pipeline/:name',       jwtAuth, json, updatePipeline);
router.delete('/pipeline/:name',    jwtAuth, removePipeline);
router.post('/pipeline/:name/action', jwtAuth, json, pipelineAction);

// Logs
router.get('/logs', jwtAuth, getLogs);

module.exports = router;
