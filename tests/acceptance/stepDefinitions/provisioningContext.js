const { client } = require('nightwatch-api')
const { Given, After } = require('cucumber')
const fs = require('fs-extra')
require('url-search-params-polyfill')
const httpHelper = require('../helpers/httpHelper')
const backendHelper = require('../helpers/backendHelper')
const userSettings = require('../helpers/userSettings')
const codify = require('../helpers/codify')
const { join } = require('../helpers/path')

const ldap = require('../helpers/ldapHelper')

function createDefaultUser(userId) {
  const password = userSettings.getPasswordForUser(userId)
  const displayname = userSettings.getDisplayNameOfDefaultUser(userId)
  const email = userSettings.getEmailAddressOfDefaultUser(userId)
  if (client.globals.ldap) {
    return ldap.createUser(client.globals.ldapClient, userId)
  }
  return createUser(userId, password, displayname, email)
}

function createUser(userId, password, displayName = false, email = false) {
  const body = new URLSearchParams()
  if (client.globals.ocis) {
    if (email === false) {
      email = userId + '@example.com'
    }
    body.append('username', userId)
    body.append('email', email)
  }
  body.append('userid', userId)
  body.append('password', password)
  const promiseList = []

  userSettings.addUserToCreatedUsersList(userId, password, displayName, email)
  const url = 'cloud/users'
  return httpHelper
    .postOCS(url, 'admin', body)
    .then(() => {
      if (client.globals.ocis) {
        const skelDir = client.globals.ocis_skeleton_dir
        if (skelDir) {
          const dataDir = join(client.globals.ocis_data_dir, 'data', userId)
          if (!fs.existsSync(dataDir)) {
            fs.removeSync(dataDir)
            fs.mkdirpSync(dataDir)
          }
          return fs.copy(skelDir, join(dataDir, 'files'))
        }
      }
      if (displayName !== false) {
        promiseList.push(
          new Promise((resolve, reject) => {
            const body = new URLSearchParams()
            body.append('key', 'display')
            body.append('value', displayName)
            const url = `cloud/users/${encodeURIComponent(userId)}`
            httpHelper.putOCS(url, 'admin', body).then(res => {
              if (res.status !== 200) {
                reject(new Error('Could not set display name of user'))
              }
              resolve(res)
            })
          })
        )
      }
    })
    .then(() => {
      if (client.globals.ocis) {
        return
      }
      if (email !== false) {
        promiseList.push(
          new Promise((resolve, reject) => {
            const body = new URLSearchParams()
            body.append('key', 'email')
            body.append('value', email)
            const url = `cloud/users/${encodeURIComponent(userId)}`
            httpHelper.putOCS(url, 'admin', body).then(res => {
              if (res.status !== 200) {
                reject(new Error('Could not set email of user'))
              }
              resolve()
            })
          })
        )
      }
    })
    .then(() => {
      return Promise.all(promiseList)
    })
}

function deleteUser(userId) {
  userSettings.deleteUserFromCreatedUsersList(userId)
  const url = `cloud/users/${userId}`
  return httpHelper.deleteOCS(url)
}

function initUser(userId) {
  const url = `cloud/users/${userId}`
  return httpHelper.getOCS(url, userId)
}

/**
 *
 * @param {string} groupId
 * @returns {*|Promise}
 */
function createGroup(groupId) {
  if (client.globals.ocis) {
    return ldap.createGroup(client.globals.ldapClient, groupId).then(err => {
      if (!err) {
        userSettings.addGroupToCreatedGroupsList(groupId)
      }
    })
  }
  const body = new URLSearchParams()
  body.append('groupid', groupId)
  userSettings.addGroupToCreatedGroupsList(groupId)
  const url = 'cloud/groups'
  return httpHelper.postOCS(url, 'admin', body)
}

/**
 *
 * @param {string} groupId
 * @returns {*|Promise}
 */
function deleteGroup(groupId) {
  userSettings.deleteGroupFromCreatedGroupsList(groupId)
  const url = `cloud/groups/${groupId}`
  return httpHelper.deleteOCS(url)
}

function addToGroup(userId, groupId) {
  if (client.globals.ocis) {
    return ldap.addUserToGroup(client.globals.ldapClient, userId, groupId)
  }
  const body = new URLSearchParams()
  body.append('groupid', groupId)
  const url = `cloud/users/${userId}/groups`
  return httpHelper.postOCS(url, 'admin', body)
}

Given('user {string} has been created with default attributes', async function(userId) {
  await deleteUser(userId)
  await createDefaultUser(userId)
  await initUser(userId)
})

Given('user {string} has been created with default attributes on remote server', function(userId) {
  return backendHelper.runOnRemoteBackend(async function() {
    await deleteUser()
      .then(() => createDefaultUser(userId))
      .then(() => initUser(userId))
  })
})

Given('the quota of user {string} has been set to {string}', function(userId, quota) {
  const body = new URLSearchParams()
  body.append('key', 'quota')
  body.append('value', quota)
  const url = `cloud/users/${userId}`
  return httpHelper
    .putOCS(url, 'admin', body)
    .then(res => httpHelper.checkStatus(res, 'Could not set quota.'))
})

Given('these users have been created with default attributes but not initialized:', function(
  dataTable
) {
  return Promise.all(
    dataTable.rows().map(userId => {
      return deleteUser(userId).then(() => createDefaultUser(userId))
    })
  )
})

Given('these users have been created but not initialized:', function(dataTable) {
  codify.replaceInlineTable(dataTable)
  return Promise.all(
    dataTable.hashes().map(user => {
      const userId = user.username
      const password = user.password || userSettings.getPasswordForUser(userId)
      const displayName = user.displayname || false
      const email = user.email || false
      return deleteUser(userId).then(() => createUser(userId, password, displayName, email))
    })
  )
})

Given('these users have been created with default attributes:', function(dataTable) {
  return Promise.all(
    dataTable.rows().map(user => {
      const userId = user[0]
      return deleteUser(userId)
        .then(() => createDefaultUser(userId))
        .then(() => initUser(userId))
    })
  )
})

Given('group {string} has been created', function(groupId) {
  return deleteGroup(groupId.toString()).then(() => createGroup(groupId.toString()))
})

Given('these groups have been created:', function(dataTable) {
  return Promise.all(
    dataTable.rows().map(groupId => {
      return deleteGroup(groupId.toString()).then(() => createGroup(groupId.toString()))
    })
  )
})

Given('user {string} has been added to group {string}', function(userId, groupId) {
  return addToGroup(userId, groupId)
})

After(async function() {
  const createdUsers = Object.keys(userSettings.getCreatedUsers('LOCAL'))
  const createdRemoteUsers = Object.keys(userSettings.getCreatedUsers('REMOTE'))
  const createdGroups = userSettings.getCreatedGroups()

  if (client.globals.ldap) {
    const dataDir = user => join(client.globals.ocis_data_dir, 'data', user)
    const deleteUserPromises = createdUsers.map(user =>
      ldap.deleteUser(client.globals.ldapClient, user).then(() => {
        console.log('Deleted LDAP User: ', user)
      })
    )
    const deleteUserDirectories = createdUsers.map(user => fs.remove(dataDir(user)))
    const deleteGroupPromises = createdGroups.map(group =>
      ldap.deleteGroup(client.globals.ldapClient, group).then(() => {
        console.log('Deleted LDAP Group: ', group)
      })
    )
    await Promise.all([
      ...deleteUserPromises,
      ...deleteGroupPromises,
      ...deleteUserDirectories
    ]).then(() => {
      userSettings.resetCreatedUsers()
      userSettings.resetCreatedGroups()
    })
  } else {
    await Promise.all([...createdUsers.map(deleteUser), ...createdGroups.map(deleteGroup)])
  }

  if (client.globals.ocis) {
    const dataDir = user => join(client.globals.ocis_data_dir, 'data', user)
    const deleteUserDirectories = createdUsers.map(user => fs.remove(dataDir(user)))
    await Promise.all(deleteUserDirectories)
  }

  if (client.globals.remote_backend_url) {
    return backendHelper.runOnRemoteBackend(() => Promise.all(createdRemoteUsers.map(deleteUser)))
  }
})
