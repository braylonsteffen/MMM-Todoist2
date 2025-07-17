"use strict";

/* Magic Mirror
 * Module: MMM-Todoist
 *
 * By Chris Brooker
 *
 * MIT Licensed.
 */

const NodeHelper = require("node_helper");
const request = require("request");
const showdown = require("showdown");

const markdown = new showdown.Converter();

module.exports = NodeHelper.create({
	start: function() {
		console.log("Starting node helper for: " + this.name);
	},

	socketNotificationReceived: function(notification, payload) {
		if (notification === "FETCH_TODOIST") {
			this.config = payload;
			this.fetchTodos();
		} else if (notification === "CLOSE_TASK") {
			this.closeTask(payload);
		}
	},

	fetchTodos : function() {
		var self = this;
		//request.debug = true;
		var accessCode = self.config.accessToken;
		request({
			url: self.config.apiBase + "/" + self.config.apiVersion + "/" + self.config.todoistEndpoint + "/",
			method: "POST",
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				"cache-control": "no-cache",
				"Authorization": "Bearer " + accessCode
			},
			form: {
				sync_token: "*",
				resource_types: self.config.todoistResourceType
			}
		},
		function(error, response, body) {
			if (error) {
				self.sendSocketNotification("FETCH_ERROR", {
					error: error
				});
				return console.error(" ERROR - MMM-Todoist: " + error);
			}
			if(self.config.debug){
				console.log(body);
			}
			if (response.statusCode === 200) {
				var taskJson = JSON.parse(body);
				taskJson.items.forEach((item)=>{
					item.contentHtml = markdown.makeHtml(item.content);
				});

				taskJson.accessToken = accessCode;
				self.sendSocketNotification("TASKS", taskJson);
			}
			else{
				console.log("Todoist api request status="+response.statusCode);
			}

		});
	},

	closeTask: function(payload) {
		const uuid = payload.uuid;
		const taskId = payload.taskId;
		const accessCode = this.config.accessToken;

		request({
			url: this.config.apiBase + "/" + this.config.apiVersion + "/" + this.config.todoistEndpoint + "/",
			method: "POST",
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				"cache-control": "no-cache",
				"Authorization": "Bearer " + accessCode
			},
			form: {
				commands: JSON.stringify([
					{
						type: "item_close",
						uuid: uuid,
						args: { id: taskId }
					}
				])
			}
		}, function(error, response, body) {
			if (error) {
				console.error("ERROR - MMM-Todoist: " + error);
				return;
			}
			if (response.statusCode === 200) {
				console.log("Task closed successfully: " + taskId);
			} else {
				console.error("Failed to close task. Status code: " + response.statusCode);
			}
		});
	}
});