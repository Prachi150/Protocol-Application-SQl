const { promisify } = require('util');
const exec = promisify(require('child_process').exec);

/**
 * Formats a rule object into a UFW rule string format
 * @param {Object} ruleObj - The rule object to format
 * @param {string} [ruleObj.action='allow'] - The action (allow/deny/reject/limit)
 * @param {string} [ruleObj.direction='in'] - The direction (in/out)
 * @param {string} [ruleObj.from='any'] - Source address
 * @param {string} [ruleObj.to='any'] - Destination address
 * @param {number|string} [ruleObj.port] - Port number
 * @param {string} [ruleObj.protocol] - Protocol (tcp/udp)
 * @returns {string} Formatted UFW rule string
 */
function formatRuleToString(ruleObj) {
  const {
    action = 'allow',
    direction = 'in',
    from = 'any',
    to = 'any',
    port,
    protocol
  } = ruleObj;

  let ruleString = `${action} ${direction}`;

  // Add protocol if specified
  if (protocol) {
    ruleString += ` proto ${protocol}`;
  }

  // Add from address if not 'any'
  if (from !== 'any') {
    ruleString += ` from ${from}`;
  }

  // Always include 'to any' when specifying a port
  if (port) {
    ruleString += ` to any port ${port}`;
  } else if (to !== 'any') {
    // If no port but specific 'to' address
    ruleString += ` to ${to}`;
  }

  return ruleString;
}

/**
 * Executes a UFW command with proper error handling and skipped rule detection
 * @param {string} command - The UFW command to execute
 * @returns {Promise<Object>} Result object containing:
 *   - success: boolean indicating if command executed without error
 *   - skipped: boolean indicating if rule was skipped (already exists)
 *   - output: command output if successful
 *   - error: error message if failed
 */
async function executeUFW(command) {
  try {
    const { stdout, stderr } = await exec(`sudo ufw ${command}`);
    const output = stdout || stderr;
    
    // Check if the rule was skipped
    if (output.toLowerCase().includes('skipping adding existing rule')) {
      return { 
        success: true, 
        skipped: true,
        output 
      };
    }
    
    return { 
      success: true, 
      skipped: false,
      output 
    };
  } catch (error) {
    return { 
      success: false, 
      skipped: false,
      error: error.message 
    };
  }
}

/**
 * Checks if a firewall rule is safe to apply (won't cause lockout)
 * @param {string} rule - The UFW rule string to check
 * @returns {Promise<Object>} Safety check result containing:
 *   - safe: boolean indicating if rule is safe
 *   - reason: string explaining why rule is unsafe (if applicable)
 */
async function checkRuleSafety(rule) {
  // Parse the rule components
  const ruleRegex = /^(allow|deny|reject|limit)\s+(in|out)?\s*(proto\s+\w+\s+)?(from\s+[^\s]+\s+)?(to\s+[^\s]+\s+)?(port\s+\d+)?/i;
  const match = rule.match(ruleRegex);
  
  if (!match) {
    return { safe: false, reason: 'Invalid rule format' };
  }

  const [, action, direction = 'in', proto, from, to, port] = match;

  // Get current SSH port (default 22)
  const { stdout: sshConfig } = await exec('grep "Port " /etc/ssh/sshd_config || echo "Port 22"');
  const sshPort = parseInt(sshConfig.split(' ')[1]) || 22;

  // Get current IP address
  const { stdout: ipAddr } = await exec("ip route get 1 | awk '{print $7;exit}'");
  const currentIP = ipAddr.trim();

  // Get UFW status
  const { stdout: status } = await exec('sudo ufw status');
  const isInactive = status.toLowerCase().includes('inactive');

  // If UFW is inactive and this is an allow rule for SSH, it's safe
  if (isInactive && action === 'allow' && port && port.includes(sshPort.toString())) {
    return { safe: true };
  }

  // Dangerous conditions that could cause lockout:
  const isDangerous = (
    // Denying SSH port
    (action === 'deny' || action === 'reject') &&
    (!port || port.includes(sshPort.toString())) &&
    (!from || from.includes(currentIP)) &&
    (!proto || proto.includes('tcp'))
  ) || (
    // Denying all incoming traffic without allowing SSH first
    action === 'deny' && 
    (!port && !proto && !from && !to)
  );

  if (isDangerous) {
    return {
      safe: false,
      reason: 'This rule could prevent SSH access and lock you out of the system'
    };
  }

  return { safe: true };
}

/**
 * Checks if enabling UFW is safe (won't cause lockout)
 * Verifies SSH access is preserved before enabling
 * @returns {Promise<Object>} Safety check result containing:
 *   - safe: boolean indicating if enabling UFW is safe
 *   - reason: string explaining why it's unsafe (if applicable)
 *   - message: additional information about the check
 */
async function checkUFWEnableSafety() {
  try {
    // Get current rules and status
    const { stdout: status } = await exec('sudo ufw status');
    const isInactive = status.toLowerCase().includes('inactive');
    
    // Get SSH port
    const { stdout: sshConfig } = await exec('grep "Port " /etc/ssh/sshd_config || echo "Port 22"');
    const sshPort = parseInt(sshConfig.split(' ')[1]) || 22;

    // If UFW is inactive, we just need to ensure we're adding the SSH rule first
    if (isInactive) {
      return { 
        safe: true,
        message: 'UFW is inactive. Please add SSH allow rule before enabling.'
      };
    }

    // If UFW is active, check existing rules
    const { stdout: rules } = await exec('sudo ufw status numbered');
    
    // Check if there's an allow rule for SSH
    const hasSSHAllow = rules.toLowerCase().includes(`allow ${sshPort}`) ||
                       rules.toLowerCase().includes('allow ssh');

    if (!hasSSHAllow) {
      return {
        safe: false,
        reason: 'Enabling UFW without an SSH allow rule could lock you out. Add a rule to allow SSH first.'
      };
    }

    return { safe: true };
  } catch (error) {
    return {
      safe: false,
      reason: `Failed to check UFW safety: ${error.message}`
    };
  }
}

/**
 * Parses UFW rules output into structured format
 * @param {string} rulesOutput - Raw UFW rules output
 * @returns {Array<Object>} Array of parsed rule objects containing:
 *   - number: rule number
 *   - action: allow/deny/reject/limit
 *   - direction: in/out
 *   - from: source address
 *   - to: destination address
 *   - port: port number
 *   - proto: protocol
 *   - ipVersion: v4/v6
 */
function parseUFWRules(rulesOutput) {
  const rules = [];
  const lines = rulesOutput.split('\n');
  
  // Find where the rules table starts (after the header)
  const startIndex = lines.findIndex(line => line.includes('To') && line.includes('Action') && line.includes('From'));
  if (startIndex === -1) return rules;

  // Process each rule line
  for (let i = startIndex + 2; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line === '') continue;

    // Extract rule number and content
    const ruleMatch = line.match(/\[\s*(\d+)\]\s+(.*)/);
    if (!ruleMatch) continue;

    const [, ruleNum, ruleContent] = ruleMatch;
    
    // Parse rule content
    const rule = {
      number: parseInt(ruleNum),
      action: 'ALLOW', // Default since we see ALLOW in the output
      direction: 'IN',  // Default since we see IN in the output
      from: 'Anywhere',
      to: 'any',
      port: null,
      proto: null,
      ipVersion: 'v4'
    };

    // Parse the rule content
    const parts = ruleContent.split(/\s+/);
    
    // Parse destination (To) part
    const destPart = parts[0];
    if (destPart.includes('/')) {
      // Format: "22/tcp" or similar
      const [port, proto] = destPart.split('/');
      rule.port = parseInt(port);
      rule.proto = proto;
    } else if (!isNaN(destPart)) {
      // Just a port number
      rule.port = parseInt(destPart);
    } else if (destPart.includes('.')) {
      // IP address with port
      const [ip, port] = destPart.split(/\s+/);
      rule.to = ip;
      if (port && port.includes('/')) {
        const [portNum, proto] = port.split('/');
        rule.port = parseInt(portNum);
        rule.proto = proto;
      } else if (port) {
        rule.port = parseInt(port);
      }
    }

    // Parse source (From) part - it's always the last part
    const fromPart = parts[parts.length - 1];
    if (fromPart !== 'Anywhere' && !fromPart.includes('(v6)')) {
      rule.from = fromPart;
    }

    // Check for IPv6
    if (line.includes('(v6)')) {
      rule.ipVersion = 'v6';
    }

    rules.push(rule);
  }

  return rules;
}

/**
 * UFW (Uncomplicated Firewall) Controller
 * Provides REST API endpoints for managing the UFW firewall
 */
const firewallController = {
  /**
   * Get UFW Status
   * Returns verbose status of UFW including all active rules
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @returns {Promise<void>} JSON response with UFW status
   */
  async getStatus(req, res) {
    try {
      const { stdout } = await exec('sudo ufw status verbose');
      res.json({
        success: true,
        status: stdout
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },

  /**
   * Get UFW Rules
   * Returns list of all configured UFW rules in structured format
   * Handles both active and inactive UFW states
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @returns {Promise<void>} JSON response with parsed rules
   */
  async getRules(req, res) {
    try {
      const { stdout: status } = await exec('sudo ufw status');
      const isInactive = status.toLowerCase().includes('inactive');

      if (isInactive) {
        return res.json({
          success: true,
          status: 'inactive',
          rules: [],
          message: 'UFW is currently inactive. No rules are being enforced.'
        });
      }

      const { stdout } = await exec('sudo ufw status numbered');
      const parsedRules = parseUFWRules(stdout);
      
      res.json({
        success: true,
        status: 'active',
        rawOutput: stdout,
        rules: parsedRules
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },

  /**
   * Add UFW Rule(s)
   * Adds one or more firewall rules after safety checks
   * Supports both string and object rule formats
   * Handles duplicate rules gracefully
   * @param {Object} req - Express request object
   * @param {Object} req.body - Request body
   * @param {string} [req.body.rule] - Single rule string
   * @param {Array<Object>} [req.body.rules] - Array of rule objects
   * @param {Object} res - Express response object
   * @returns {Promise<void>} JSON response with results
   */
  async addRule(req, res) {
    try {
      const { rule, rules } = req.body;

      // Handle array of rule objects
      if (rules && Array.isArray(rules)) {
        const results = [];
        let hasNewRules = false;
        let hasSkippedRules = false;

        for (const ruleObj of rules) {
          // Convert rule object to UFW rule string
          const ruleString = formatRuleToString(ruleObj);
          
          // Check rule safety
          const safety = await checkRuleSafety(ruleString);
          if (!safety.safe) {
            return res.status(400).json({
              success: false,
              error: safety.reason,
              rule: ruleObj
            });
          }

          // Add the rule
          const result = await executeUFW(ruleString);
          if (!result.success) {
            return res.status(500).json({
              success: false,
              error: result.error,
              results
            });
          }

          hasNewRules = hasNewRules || !result.skipped;
          hasSkippedRules = hasSkippedRules || result.skipped;

          results.push({
            rule: ruleObj,
            success: result.success,
            skipped: result.skipped,
            output: result.output,
            error: result.error
          });
        }

        let message = '';
        if (hasNewRules && hasSkippedRules) {
          message = 'Some rules added, some rules skipped (already exist)';
        } else if (hasNewRules) {
          message = 'All rules added successfully';
        } else if (hasSkippedRules) {
          message = 'All rules skipped (already exist)';
        }

        return res.json({
          success: true,
          message,
          results
        });
      }

      // Handle single rule string
      if (rule) {
        // Check rule safety
        const safety = await checkRuleSafety(rule);
        if (!safety.safe) {
          return res.status(400).json({
            success: false,
            error: safety.reason
          });
        }

        // Add the rule
        const result = await executeUFW(rule);
        if (!result.success) {
          return res.status(500).json({
            success: false,
            error: result.error
          });
        }

        const message = result.skipped ? 
          'Rule skipped (already exists)' : 
          'Rule added successfully';

        return res.json({
          success: true,
          skipped: result.skipped,
          message,
          output: result.output
        });
      }

      return res.status(400).json({
        success: false,
        error: 'Either rule string or rules array is required'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },

  /**
   * Delete UFW Rule
   * Removes a firewall rule by its rule number
   * @param {Object} req - Express request object
   * @param {Object} req.params - URL parameters
   * @param {string} req.params.ruleNum - Rule number to delete
   * @param {Object} res - Express response object
   * @returns {Promise<void>} JSON response with deletion result
   */
  async deleteRule(req, res) {
    try {
      const { ruleNum } = req.params;

      if (!ruleNum) {
        return res.status(400).json({
          success: false,
          error: 'Rule number is required'
        });
      }

      // Delete the rule
      const result = await executeUFW(`--force delete ${ruleNum}`);
      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: result.error
        });
      }

      res.json({
        success: true,
        message: 'Rule deleted successfully',
        output: result.output
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },

  /**
   * Enable UFW
   * Enables the firewall after safety checks
   * Ensures SSH access is preserved
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @returns {Promise<void>} JSON response with enable result
   */
  async enableFirewall(req, res) {
    try {
      // Check if enabling UFW is safe
      const safety = await checkUFWEnableSafety();
      if (!safety.safe) {
        return res.status(400).json({
          success: false,
          error: safety.reason
        });
      }

      // If UFW is inactive and we're enabling it, make sure we have SSH access rule
      if (safety.message && safety.message.includes('inactive')) {
        // Add SSH allow rule first
        const sshRule = 'allow in proto tcp to any port 22';
        const sshResult = await executeUFW(sshRule);
        if (!sshResult.success) {
          return res.status(500).json({
            success: false,
            error: `Failed to add SSH allow rule: ${sshResult.error}`
          });
        }
      }

      // Enable UFW
      const result = await executeUFW('enable');
      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: result.error
        });
      }

      res.json({
        success: true,
        message: 'UFW enabled successfully',
        output: result.output
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },

  /**
   * Disable UFW
   * Disables the firewall
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @returns {Promise<void>} JSON response with disable result
   */
  async disableFirewall(req, res) {
    try {
      const result = await executeUFW('disable');
      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: result.error
        });
      }

      res.json({
        success: true,
        message: 'UFW disabled successfully',
        output: result.output
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
};

module.exports = firewallController; 