package photos.utility;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.ObjectInputStream;
import java.io.ObjectOutputStream;
import java.io.Serializable;
import java.util.ArrayList;

import photos.controller.LoginController;

/**
A class that manages the privacy-related functionality of the photo application, such as the total list of user, the serial and deserialization
@author Zihao Zheng , Yiming Huang.
@since 4/13/23
*/
public class Privacy implements Serializable{
	private static final long serialVersionUID = 1L;
	
	/**
	 * The list of users, including Admin and Non-Admin
	 * */
	public static ArrayList<User> users;
	
	/**
	 * The directory of the file that stores usernames
	 * */
	public static final String storeDir = "src/photos/utility"; 
	
	/**
	 * The name of the file in the target directory
	 * */
	public static final String storeFile = "users.dat"; // The file name
	
	/**
	 * The saved username. userful when logged out, since it saves the username so we don't have to re-enter it again
	 * */
	public static String savedUsername = null;
	
	/**
	 * The user currently logged in
	 * */
	public static User currentUser;
	
	/**
	 * The method for initializing the Privacy class. it deserializes the data from file so the session before is loaded
	 * @throws IOException a exception if the deserialize is failed
	 * */
	public static void init() throws IOException {
		// retrieve the data from the file and insert it into the array list
		deserialize();
	}
	
	/**
	 * The method for serializing the all the users and its data into the data file.
	 *  @throws IOException a exception if the serialize is failed
	 */
	public static void serialize() throws IOException{
		try {
            FileOutputStream fileOut = new FileOutputStream(storeDir + File.separator + storeFile);
            ObjectOutputStream out = new ObjectOutputStream(fileOut);
            out.writeObject(users);
            out.close();
            fileOut.close();
        } catch (IOException i) {
            i.printStackTrace();
        }
	}
	
	/**
	 * The method for deserializing the all the users and its data out of the data file.
	 *  @throws IOException a exception if the deserialize is failed
	 */
	@SuppressWarnings("unchecked")
	public static void deserialize() throws IOException{
		try {
            FileInputStream fileIn = new FileInputStream(storeDir + File.separator + storeFile);
            ObjectInputStream in = new ObjectInputStream(fileIn);
            users = (ArrayList<User>) in.readObject();
            in.close();
            fileIn.close();
        } catch (IOException i) {
            i.printStackTrace();
            return;
        } catch (ClassNotFoundException c) {
            c.printStackTrace();
            return;
        }
	}
	
	/**
	 * The method for updating the current list of users. Only used when we are manually changing the users
	 * @param updatedUser the arraylist of updated users
	 */
	public static void update(ArrayList<User> updatedUser) {
		users=updatedUser;
	}
	
	/**
	 * The method for adding a user to the list and update it to the data file 
	 * @param user The user to be added
	 * @throws IOException the exception when the serialization fails
	 */
	public static void add(User user) throws IOException {
		// add to the array list
		users.add(user);
		
		// update the file
		serialize();
	}
	
	/**
	 * The method that prints out all the users in the list. The is only used for debug purposes
	 * @throws IOException exception when deserialize fails
	 */
	public static void print() throws IOException {
		if(users==null) {
			deserialize();
		}
		if(LoginController.debug==true) {
			System.out.println("Total Users:"+users.size()+"\n");

		}
		/*For debug purposes, it prints out all the username and the equivalent passwords, and the type of user*/
		for (User user : users) {
			if(LoginController.debug==true) {
				System.out.println("\nUsername:"+user.getUsername()+"-----Password:"+user.getPassword()+"-----Type:"+user.getType());

			}
          ArrayList<Album> albums = user.albums;
          if(albums == null || albums.size()<=0) {
        	  continue;
          }
          for (Album album : albums) {
        	  if(LoginController.debug==true) {
        		  System.out.println("\tAlbum: " + album.getAlbumName());
        	  }
              ArrayList<Photo> photos = album.getPhotos();
              for (Photo photo : photos) {
            	  if(LoginController.debug==true) {
            		  System.out.println("\t\tPhoto: " + new File(photo.getPath()).getName());
            	  }
              }
          }
		}
	}
}